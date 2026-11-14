"""iRacing -> HUD Bridge. Installation: pip install pyirsdk websockets
Start (iRacing laeuft, danach hud.html oeffnen): python iracing_bridge.py"""
import asyncio, json, irsdk, websockets

ir, clients = irsdk.IRSDK(), set()


def snap():
    if not ir.is_connected:
        ir.startup()
        if not ir.is_connected:
            return None
    di, me = ir['DriverInfo'], ir['DriverCarIdx']
    cars = {d['CarIdx']: d for d in di['Drivers'] if not d.get('IsSpectator')}
    pos, f2, pct = ir['CarIdxClassPosition'], ir['CarIdxF2Time'], ir['CarIdxLapDistPct']

    order = sorted((i for i in cars if pos[i] > 0), key=lambda i: pos[i])
    k = order.index(me) if me in order else 0
    lo = max(0, min(k - 2, len(order) - 5))
    stand = [[f'P{pos[i]}', cars[i]['UserName'],
              'Leader' if pos[i] == 1 else f'+{f2[i]:.1f}', i == me, cars[i]['IRating']] for i in order[lo:lo + 5]]

    est = di['DriverCarEstLapTime']
    diffs = [((pct[i] - pct[me] + .5) % 1 - .5, i) for i in cars if i != me and pct[i] >= 0]
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
    return {'rpm': ir['RPM'], 'rpmMax': di['DriverCarRedLine'], 'gear': ir['Gear'], 'speed': ir['Speed'] * 3.6,
            'delta': ir['LapDeltaToBestLap'], 'cur': ir['LapCurrentLapTime'], 'last': ir['LapLastLapTime'],
            'best': ir['LapBestLapTime'], 'lap': ir['Lap'], 'laps': total if total < 1000 else 0,
            'fuel': ir['FuelLevel'], 'throttle': ir['Throttle'], 'brake': ir['Brake'],
            'abs': bool(ir['BrakeABSactive']), 'latG': ir['LatAccel'] / 9.81, 'lonG': ir['LongAccel'] / 9.81,
            'flags': ir['SessionFlags'], 'session': sess,
            'alerts': alerts, 'cars': cars_out, 'track': ir['WeekendInfo']['TrackName'], 'yaw': ir['Yaw'], 'pct': ir['LapDistPct'], 'tires': tires, 'stand': stand, 'rel': rel}


async def handler(ws):
    clients.add(ws)
    try:
        await ws.wait_closed()
    finally:
        clients.discard(ws)


async def main():
    async with websockets.serve(handler, 'localhost', 8765):
        while True:
            try:
                s = snap()
            except Exception:
                s = None
            if s and clients:
                websockets.broadcast(clients, json.dumps(s))
            await asyncio.sleep(0.05)


if __name__ == '__main__':
    asyncio.run(main())
