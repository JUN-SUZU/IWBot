const { ActivityType, Client, Collection, EmbedBuilder, Events, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const cron = require('node-cron');
const config = require('./config.json');
const { spawn } = require('child_process');
const convertToHiragana = require('./hiragana.js');
const baseColor = '#ff207d';

// define discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.MessageContent
    ]
});

// discord client ready
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    log = client.channels.cache.get(config.logChannelId);
    cmd = client.channels.cache.get(config.commandChannelId);
    chat = client.channels.cache.get(config.chatChannelId);
    joinLeaveC = client.channels.cache.get(config.joinLeaveChannelId);
});

// offline, booting, online, shuttingdown
let status = "offline";
let child = null;
let log;
let cmd;
let chat;
let joinLeaveC;
let latestLog1000 = '';
let logTimeDelay = new Date().getTime();

let onlinePlayers = new Collection();

function SendEmbed(data,description = null, send = cmd) {
    let embed = new EmbedBuilder()
        .setTitle(data)
        .setColor(baseColor)
        .setTimestamp();
    if (description) {
        embed.setDescription(description);
        }

    send.send({ embeds: [embed] });
}

// discord からのメッセージ受付
client.on('messageCreate', (message) => {
    if (message.author.bot) return; // botなら無視
    if (message.channelId === config.chatChannelId && status === "online") {
        // message.author.username
        let author = message.author;
        let content = message.content;
        let userdata = JSON.parse(fs.readFileSync('/home/jun/IWBot/userdata.json', 'utf8'));
        let id = userdata.filter((user) => user[1] === author.id);
        if (id.length === 1 && id[0][2] != undefined && id[0][2]) {
            content += "ざぁこ♡";
        }
        child.stdin.write(`tellraw @a {"text":"<${message.member.displayName}> ${content}","color":"${message.member.displayHexColor}"}\r\n`);
    }
    if (message.channelId === config.logChannelId && status === "online") {
        // send command to server
        child.stdin.write(`${message.content}\r\n`);
    }
    const permission = message.member.roles.cache.has(config.roles.admin) || message.member.roles.cache.has(config.roles.mod);
    if (message.channelId === config.commandChannelId) {
        let command = message.content.split(' ');
        if (command[0] === config.prefix && permission) {
            console.log(`Command has been called ${command[1]}`);
            if (command[1] === 'b' || command[1] === 'boot') {
                if (status === "offline") {
                    SendEmbed('サーバーを起動するよん')
                    serverStart();
                }
                else {
                    message.reply('サーバーは既にオンラインです。');
                }
            }
            else if (command[1] === 's' || command[1] === 'shutdown') {
                if (status === "online") {
                    SendEmbed('サーバーをシャットダウンするよん')
                    serverStop('shutdown');
                }
                else {
                    message.reply('サーバーは既にオフラインです。');
                }
            }
            else if (command[1] === 'r' || command[1] === 'reboot') {
                if (status === "online") {
                    SendEmbed('サーバーを再起動するよん')
                    serverStop('reboot');
                }
                else {
                    message.reply('サーバーは既にオフラインです。');
                }
            }
            else if (command[1] === 'l' || command[1] === 'log') {
                SendEmbed('最新のログを表示するよん', latestLog1000,log)
            }
            else if (command[1] === 'status') {
                SendEmbed('サーバーのステータス', status)
            }

            else if (command[1] === 'p' || command[1] === 'ping') {
                SendEmbed('Pong!', `${client.ws.ping}ms`)
            }
            else if (command[1] === 'h' || command[1] === 'help') {
                let command = "`cmd b` or `cmd boot` : サーバーを起動するよん\n`cmd s` or `cmd shutdown` : サーバーをシャットダウンするよん\n`cmd r` or `cmd reboot` : サーバーを再起動するよん\n`cmd l` or `cmd log` : 最新のログを表示するよん\n`cmd status` : サーバーのステータスを表示するよん\n`cmd p` or `cmd ping` : ピンポンをするよん\n`cmd h` or `cmd help` : コマンド一覧を表示するよん"
                SendEmbed('コマンド一覧', command)
            }
        }
    }
});

function serverStart() {
    if (status === "online") return;
    child = spawn('bash', ['/home/jun/forge/run.sh']);
    status = "booting";
    fs.writeFileSync('/home/jun/IWBot/serverpid', child.pid.toString(), 'utf8');
    child.stdout.on('data', (data) => {
        // bootchecker
        if (data.toString().includes('server boot checker') && status === "booting") {
            SendEmbed('サーバーが起動したよん');
            status = "online";
        }
        logTimeDelay = new Date().getTime();
        handleLog(data);
        latestLog1000 += data.toString();
        if (latestLog1000.length > 1000) {
            latestLog1000 = latestLog1000.slice(latestLog1000.length - 1000);
        }
    });
    child.on('close', (code) => {
        console.log(`Child process exited with code ${code}.`);
        log.send(`Child process exited with code ${code}.`);
        if (status === "rebooting") {
            serverStart();
        }
        else {
            status = "offline";
        }
        fs.writeFileSync('/home/jun/IWBot/serverpid', '');
    });
}

// 10秒ごとにログをチェックして、サーバーの起動を確認する
cron.schedule('*/10 * * * * *', () => {
    if (status === "booting") {
        let currentTime = new Date().getTime();
        if (currentTime - logTimeDelay > 10000) {// 10秒以上ログが更新されていない場合にサーバーの起動が完了したか確認する
            child.stdin.write('say server boot checker\r\n');
        }
    }
});

function handleLog(data) {
    let log = data.toString();
    shareMessage(log);
    joinLeave(log);
    recoveryError(log);
}

function serverStop(type) {
    if (type === 'reboot') {
        child.stdin.write('kick @a サーバーが再起動するよん\r\n');
        status = "rebooting";
    }
    else {
        child.stdin.write('kick @a サーバーが停止するよん\r\n');
        status = "shuttingdown";
    }
    onlinePlayers.clear();
    child.stdin.write('stop\r\n');
    child.stdin.end(); // EOF
    fs.writeFileSync('/home/jun/IWBot/serverpid', '');
}

// 深夜2時にサーバーを停止する
cron.schedule('0 2 * * *', () => {
    if (status === "online") {
        serverStop('shutdown');
    }
});
// 朝の6時にサーバーを起動する
cron.schedule('0 6 * * *', () => {
    if (status === "offline") {
        serverStart();
    }
});

function shareMessage(message) {
    // messageがゲーム内のユーザーのチャットであるか検証する。
    // [08:03:12] [Server thread/INFO] [minecraft/DedicatedServer]: <JUNmaster108> こんにちは
    // チャットメッセージの形式を検証する
    const chatMessage = /\[\d{2}:\d{2}:\d{2}\] \[Server thread\/INFO\] \[net.minecraft.server.MinecraftServer\/\]: <\w+> .+/;
    if (chatMessage.test(message)) {
        let username = message.match(/(?<=<)\w+(?=>)/)[0];
        let content = message.match(/(?<=> ).+/)[0];
        // ルナチャット
        let URI = "http://www.google.com/transliterate?";
        if (content.length > 15) {
            let kana = convertToHiragana(content);
            if (content.length * 7 > kana.length * 10 && kana.length < 50) {
                let langpair = "ja-Hira|ja";
                let url = URI + "text=" + encodeURIComponent(kana) + "&langpair=" + langpair;
                fetch(url)
                    .then(response => response.json())
                    .then(data => {
                        let result = "";
                        data.forEach(element => {
                            result += element[1][0];
                        });
                        console.log(result);
                        child.stdin.write(`tellraw @a {"text":"<${username}> ${result}","color":"#c0c0c0"}\r\n`);
                        sendMessageToChat(username, content, result);
                    });
            }
            else {
                sendMessageToChat(username, content);
            }
        }
        else {
            sendMessageToChat(username, content);
        }
        function sendMessageToChat(username, content, kana = null) {
            let userdata = JSON.parse(fs.readFileSync('/home/jun/IWBot/userdata.json', 'utf8'));
            let id = userdata.filter((user) => user[0] === username);
            if (id.length === 0) return;
            let user = client.users.cache.get(id[0][1]);
            // メスガキ化
            if (id[0][2] != undefined && id[0][2]) {
                content += "ざぁこ♡";
            }
            try {
                console.log(`User: ${user.username}`);
                let embed = new EmbedBuilder()
                    .setTitle(username)
                    .setDescription(content)
                    .setThumbnail(user.displayAvatarURL())
                    .setColor(baseColor)
                    .setTimestamp();
                if (kana !== null) {
                    embed.addFields(
                        { name: 'Kana', value: kana }
                    );
                }
                chat.send({ embeds: [embed] });
            }
            catch (e) {
                console.log(e);
            }
        }
    }
}

function joinLeave(message) {
    // [23:55:08] [Server thread/INFO] [minecraft/DedicatedServer]: JUNmaster108 left the game
    // [23:55:08] [Server thread/INFO] [minecraft/DedicatedServer]: JUNmaster108 joined the game
    // [23:55:08] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: maguro1712 joined the game
    // MinecraftServer
    const joinLeave = /\[\d{2}:\d{2}:\d{2}\] \[Server thread\/INFO\] \[net.minecraft.server.MinecraftServer\/\]: \w+ (left|joined) the game/;
    if (joinLeave.test(message)) {
        let username = message.match(/\w+(?= (left|joined) the game)/)[0];
        let entryLeavingWhich = message.match(/(?<=\[Server thread\/INFO\] \[net.minecraft.server.MinecraftServer\/\]: \w+ )(left|joined)/)[0];
        // サーバーが起動中の場合キックしてreturn
        if (status === "booting") {
            child.stdin.write(`kick ${username} サーバーが起動中だよん\r\n`);
            return;
        }
        if (entryLeavingWhich === 'joined') {
            onlinePlayers.set(username, new Date().getTime());
        }
        else {
            onlinePlayers.delete(username);
        }
        // BOTのステータスにプレイヤーの数を表示する
        client.user.setActivity(`${onlinePlayers.size} players`, { type: ActivityType.Streaming });
        // BOTの自己紹介にプレイヤーの名前を表示する
        let description = '';
        onlinePlayers.forEach((value, key) => {
            description += key + '\n';
        });
        client.user.setPresence({ activities: [{ name: description, type: ActivityType.Playing }] });
        let embed = new EmbedBuilder()
            .setTitle(username)
            .setDescription(entryLeavingWhich === 'joined' ? '参加したよん' + ':green_circle:' : '退出したよん' + ':red_circle:')
            .setColor(baseColor)
            .setTimestamp();
        joinLeaveC.send({ embeds: [embed] });
    }
}

function recoveryError(message) {
    // [00:04:11] [Server Watchdog/ERROR] [minecraft/ServerWatchdog]: A single server tick took 60.00 seconds (should be max 0.05)
    const error = /\[\d{2}:\d{2}:\d{2}\] \[Server Watchdog\/ERROR\] \[minecraft\/ServerWatchdog\]: A single server tick took \d+\.\d+ seconds \(should be max 0.05\)/;
    if (error.test(message)) {
        SendEmbed('エラーが発生したよん', message, log);
        SendEmbed('エラーが発生したよん', 'サーバーが重いので再起動するよん', chat);
        // サーバーが停止するのを待ち、再起動する
        status = "rebooting";
    }
}

try {
    let pid = fs.readFileSync('/home/jun/IWBot/serverpid', 'utf8');
    fs.writeFileSync('/home/jun/IWBot/serverpid', '');
    if (pid.length > 0) process.kill(pid);
}
catch (e) {
    console.log(e);
    console.log('No longer running server');
}

client.login(config.token);
