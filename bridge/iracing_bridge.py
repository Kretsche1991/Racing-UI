"""iRacing -> HUD Bridge: liest die iRacing-Telemetrie und schickt sie per WebSocket ans HUD."""
import asyncio, json, math, os, time, traceback
import irsdk, websockets

ir, clients = irsdk.IRSDK(), set()
TOKEN = os.environ.get('HUD_TOKEN', '')  # vom HUD-Programm vergeben; verhindert Zugriff durch fremde Webseiten
LOGDIR = os.environ.get('HUD_LOGDIR') or os.path.join(os.environ.get('APPDATA', '.'), 'iRacingHUD')
last_err = ''


def log(text):
    global last_err
    last_err = (text.strip().splitlines() or [''])[-1][:200]
    try:
        os.makedirs(LOGDIR, exist_ok=True)
        f = os.path.join(LOGDIR, 'bridge.log')
        if os.path.exists(f) and os.path.getsize(f) > 200_000:
            os.remove(f)
        with open(f, 'a', encoding='utf-8') as fh:
            fh.write(time.strftime('%Y-%m-%d %H:%M:%S ') + text.strip() + '\n')
    except Exception:
        pass


def snap():
    if not ir.is_connected:
        ir.startup()
        if not ir.is_connected:
            return None
    di, me = ir['DriverInfo'], ir['DriverCarIdx']
    cars = {d['CarIdx']: d for d in di['Drivers'] if not d.get('IsSpectator') and not d.get('CarIsPaceCar')}
    pos, f2, pct = ir['CarIdxClassPosition'], ir['CarIdxF2Time'], ir['CarIdxLapDistPct']

    cid = cars[me].get('CarClassID')
    ccars = [i for i in cars if cars[i].get('CarClassID') == cid]  # nur die eigene Klasse
    order = sorted((i for i in ccars if pos[i] > 0), key=lambda i: pos[i])
    base = f2[order[0]] if order else 0
    k = order.index(me) if me in order else 0
    lo = max(0, min(k - 2, len(order) - 5))
    stand = [[f'P{pos[i]}', cars[i]['UserName'],
              'Leader' if pos[i] == 1 else f'+{f2[i] - base:.1f}', i == me, cars[i]['IRating']] for i in order[lo:lo + 5]]

    est, et = di['DriverCarEstLapTime'], ir['CarIdxEstTime']

    def frac(i):  # Abstand als Bruchteil einer Runde; nach Moeglichkeit ueber iRacings geschaetzte Streckenzeit
        if est > 0 and et[me] >= 0 and et[i] >= 0:
            return ((et[i] - et[me]) / est + .5) % 1 - .5
        return (pct[i] - pct[me] + .5) % 1 - .5

    diffs = [(frac(i), i) for i in cars if i != me and pct[i] >= 0]
    ahead = sorted((x for x in diffs if x[0] > 0), key=lambda x: x[0])[:2][::-1]
    behind = sorted((x for x in diffs if x[0] < 0), key=lambda x: -x[0])[:2]
    row = lambda d, i, you=False: [f'{-d * est:+.1f}' if not you else '0.0',
                                   'Du' if you else cars[i]['UserName'], '#' + str(cars[i]['CarNumber']), you, cars[i]['IRating']]
    rel = [row(d, i) for d, i in ahead] + [row(0, me, True)] + [row(d, i) for d, i in behind]

    mycls, pit = cars[me].get('CarClassEstLapTime', 0), ir['CarIdxOnPitRoad']
    col = lambda i: '#%06x' % cars[i].get('CarClassColor', 0xFFFFFF)
    alerts = sorted(({'name': cars[i]['UserName'], 'num': '#' + str(cars[i]['CarNumber']), 'gap': -d * est, 'color': col(i)}
                     for d, i in diffs if d < 0 and -d * est < 8 and not pit[i]
                     and 0 < cars[i].get('CarClassEstLapTime', 0) < mycls * 0.98), key=lambda a: a['gap'])
    cars_out = [[pct[i], i == me, col(i), bool(pit[i])] for i in cars if pct[i] >= 0]
    tires = [{'t': ir[c + 'tempCM'], 'w': (1 - ir[c + 'wearM']) * 100} for c in ('LF', 'RF', 'LR', 'RR')]
    total = ir['SessionLapsTotal']
    st = ir['SessionInfo']['Sessions'][ir['SessionNum']]['SessionType']
    sess = 'Race' if st == 'Race' else 'Qualify' if 'Qualify' in st else 'Practice'

    def pick(x):
        return None if x is None else [cars[x[0]]['UserName'], max(0, x[1])]
    if sess == 'Race' and me in order:  # Rennen: Zeitabstand ueber die Klassenposition
        j = order.index(me)
        ga = (order[j - 1], f2[me] - f2[order[j - 1]]) if j > 0 else None
        gb = (order[j + 1], f2[order[j + 1]] - f2[me]) if j + 1 < len(order) else None
    else:  # Training/Quali: naechstes Auto der eigenen Klasse auf der Strecke
        same = [x for x in diffs if x[1] in ccars]
        fa = min((x for x in same if x[0] > 0), key=lambda x: x[0], default=None)
        fb = min((x for x in same if x[0] < 0), key=lambda x: -x[0], default=None)
        ga = (fa[1], fa[0] * est) if fa else None
        gb = (fb[1], -fb[0] * est) if fb else None
    gaps = {'a': pick(ga), 'b': pick(gb)}

    wi = ir['WeekendInfo']
    return {'rpm': ir['RPM'], 'rpmMax': di['DriverCarRedLine'], 'gear': ir['Gear'], 'speed': ir['Speed'] * 3.6,
            'delta': ir['LapDeltaToBestLap'], 'deltaOk': bool(ir['LapDeltaToBestLap_OK']),
            'cur': ir['LapCurrentLapTime'], 'last': ir['LapLastLapTime'],
            'best': ir['LapBestLapTime'], 'lap': ir['Lap'], 'laps': total if total < 1000 else 0,
            'fuel': ir['FuelLevel'], 'fuelMax': di['DriverCarFuelMaxLtr'] * di['DriverCarMaxFuelPct'],
            'timeRemain': ir['SessionTimeRemain'], 'onPit': bool(ir['OnPitRoad']),
            'inCar': bool(ir['IsOnTrack']) and not ir['IsReplayPlaying'],
            'throttle': ir['Throttle'], 'brake': ir['Brake'],
            'abs': bool(ir['BrakeABSactive']), 'latG': ir['LatAccel'] / 9.81, 'lonG': ir['LongAccel'] / 9.81,
            'flags': ir['SessionFlags'], 'session': sess,
            'alerts': alerts, 'gaps': gaps, 'cars': cars_out,
            'track': f"{wi['TrackName']}|{wi.get('TrackConfigName') or ''}",
            'yaw': ir['Yaw'], 'pct': ir['LapDistPct'], 'tires': tires, 'stand': stand, 'rel': rel}


def handle(m):
    # Befehle vom HUD: Tankmenge im Boxenstopp-Menue setzen (offizielle iRacing-Pit-Befehle)
    if not ir.is_connected:
        return
    if m.get('cmd') == 'fuel':
        liters = float(m.get('l', 0))
        if liters > 0:
            ir.pit_command(irsdk.PitCommandMode.fuel, int(math.ceil(liters)))
        else:
            ir.pit_command(irsdk.PitCommandMode.clear_fuel)


async def handler(ws):
    try:
        async for msg in ws:
            try:
                m = json.loads(msg)
            except Exception:
                continue
            if ws not in clients:  # erst nach gueltigem Handshake Daten senden/Befehle annehmen
                if m.get('cmd') == 'hello' and (not TOKEN or m.get('tok') == TOKEN):
                    clients.add(ws)
                continue
            try:
                handle(m)
            except Exception:
                log(traceback.format_exc())
    finally:
        clients.discard(ws)


async def main():
    log('Bridge gestartet')
    lasttb = ''
    async with websockets.serve(handler, 'localhost', 8765):
        while True:
            s = None
            try:
                s = snap()
            except Exception:
                tb = traceback.format_exc()
                if tb != lasttb:
                    lasttb = tb
                    log(tb)
            if clients:
                websockets.broadcast(clients, json.dumps(s if s else {'status': 'wait', 'err': last_err}))
            await asyncio.sleep(0.05 if s else 1)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except OSError:
        pass  # Port belegt: ein anderer Bridge-Prozess laeuft bereits
