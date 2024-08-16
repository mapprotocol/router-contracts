let { create, createZk, readFromFile, writeToFile } = require("../../utils/create.js");
let { task } = require("hardhat/config");
let { getConfig } = require("../../configs/config");
let { setAuthorization } = require("../utils/util.js");
let { deploy_contract, getTronWeb, setTronAuthorization,setTronFeeV2 } = require("../utils/tronUtil.js");



module.exports = async (taskArgs, hre) => {
    const { getNamedAccounts, network } = hre;
    const { deployer } = await getNamedAccounts();

    console.log("\ndeployer :", deployer);
    let config = getConfig(network.name);
    if (!config) {
        throw "config not set";
    }
    await hre.run("routerPlusV2:deploy", { bridge: config.plusV2.bridge, wtoken: config.wToken });

    let deploy_json = await readFromFile(network.name);

    let router_addr = deploy_json[network.name]["RouterPlusV2"]["addr"];

    let executors_s = config.executors.join(",");

    await hre.run("routerPlusV2:setAuthorization", { router: router_addr, executors: executors_s });
    
    await hre.run("routerPlusV2:setFee",{
        router:router_addr,
        receiver: config.plusV2.fee.receiver,
        rate:config.plusV2.fee.feeRate,
    })

};

task("routerPlusV2:deploy", "deploy router plus v2")
    .addParam("wtoken", "wtoken address")
    .addParam("bridge", "bridge address")
    .setAction(async (taskArgs, hre) => {
        const { getNamedAccounts, ethers, network } = hre;

        let plus;
        if (network.name === "Tron" || network.name === "TronTest") {
            let tronWeb = await getTronWeb(network.name);
            let deployer = "0x" + tronWeb.defaultAddress.hex.substring(2);
            console.log("deployer :", tronWeb.address.fromHex(deployer));
            plus = await deploy_contract(hre.artifacts, "RouterPlusV2", [taskArgs.bridge, deployer, taskArgs.wToken]);
        } else {
            const { deployer } = await getNamedAccounts();
            console.log("\ndeploy butter router plus deployer :", deployer);
            let chainId = await hre.network.config.chainId;
            if (chainId === 324 || chainId === 280) {
                plus = await createZk("RouterPlusV2", [taskArgs.bridge, deployer, taskArgs.wtoken], hre);
            } else {
                let salt = process.env.PLUS_V2_DEPLOY_SALT;
                let RouterPlusV2 = await ethers.getContractFactory("RouterPlusV2");
                let param = ethers.utils.defaultAbiCoder.encode(["address","address", "address"], [taskArgs.bridge, deployer, taskArgs.wtoken]);
                let result = await create(salt, RouterPlusV2.bytecode, param);
                plus = result[0];
            }
            console.log("router plus address :", plus);
            const verifyArgs = [taskArgs.bridge, deployer, taskArgs.wtoken].map((arg) => (typeof arg == "string" ? `'${arg}'` : arg)).join(" ");
            console.log(
                `To verify, run: npx hardhat verify --network ${hre.network.name} --contract "./contracts/RouterPlusV2.sol:RouterPlusV2" ${plus} ${verifyArgs}`
            );
        }
        let deploy = await readFromFile(network.name);
        if (!deploy[network.name]["RouterPlusV2"]) {
            deploy[network.name]["RouterPlusV2"] = {};
        }
        deploy[network.name]["RouterPlusV2"]["addr"] = plus;
        await writeToFile(deploy);
    });



task("routerPlusV2:setAuthorization", "set Authorization")
    .addParam("router", "router address")
    .addParam("executors", "executors address array")
    .addOptionalParam("flag", "flag, default: true", true, types.boolean)
    .setAction(async (taskArgs, hre) => {
        const { getNamedAccounts, network } = hre;
        if (network.name === "Tron" || network.name === "TronTest") {
            let tronWeb = await getTronWeb(network.name);
            let deployer = "0x" + tronWeb.defaultAddress.hex.substring(2);
            console.log("\nset authorization deployer :", deployer);
            await setTronAuthorization(tronWeb, hre.artifacts,taskArgs.router, taskArgs.executors, taskArgs.flag);
        } else {
            const { deployer } = await getNamedAccounts();

            console.log("\nset authorization deployer :", deployer);

            await setAuthorization(taskArgs.router, taskArgs.executors, taskArgs.flag);
        }
    });

task("routerPlusV2:setFee", "set fee ")
    .addParam("router", "router address")
    .addParam("receiver", "feeReceiver address")
    .addParam("rate", "fee rate")
    .setAction(async (taskArgs, hre) => {
        const { getNamedAccounts, ethers } = hre;
        const { deployer } = await getNamedAccounts();

        if (network.name === "Tron" || network.name === "TronTest") {
            let tronWeb = await getTronWeb(network.name);
            let deployer = "0x" + tronWeb.defaultAddress.hex.substring(2);
            console.log("\nset Fee deployer :", deployer);
            await setTronFeeV2(tronWeb, hre.artifacts, taskArgs.router, taskArgs.receiver, taskArgs.rate);
        } else { 
            console.log("set fee deployer :", deployer);
            let Router = await ethers.getContractFactory("RouterPlusV2");
            let router = Router.attach(taskArgs.router);
            let result = await (await router.setFee(taskArgs.receiver, taskArgs.rate)).wait();
            if (result.status == 1) {
                console.log(
                    `Router ${taskArgs.router} setFee rate(${taskArgs.rate}),receiver(${taskArgs.receiver}) succeed`
                );
            } else {
                console.log("setFee failed");
            }
        }

    });

task("routerPlusV2:setAuthFromConfig", "set Authorization from config file")
    .addOptionalParam("router", "router address", "router", types.string)
    .setAction(async (taskArgs, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        console.log("set Authorization from config file deployer :", deployer);

        let config = getConfig(network.name);
        if (!config) {
            throw "config not set";
        }

        let deploy_json = await readFromFile(network.name);

        let router_addr = taskArgs.router;
        if (router_addr === "router") {
            if (deploy_json[network.name]["RouterPlusV2"] === undefined) {
                throw "can not get router address";
            }
            router_addr = deploy_json[network.name]["RouterPlusV2"]["addr"];
        }
        console.log("router: ", router_addr);

        let Router = await ethers.getContractFactory("RouterPlusV2");
        let router = Router.attach(router_addr);

        console.log(router.address);

        let executors = [];
        for (let i = 0; i < config.executors.length; i++) {
            let result = await await router.approved(config.executors[i]);
            if (result === false || result === undefined) {
                executors.push(config.executors[i]);
            }
        }

        if (executors.length > 0) {
            let executors_s = executors.join(",");
            console.log("routers to set :", executors_s);

            await setAuthorization(router_addr, executors_s, true);
        }

        console.log("RouterPlusV2 sync authorization from config file.");
    });