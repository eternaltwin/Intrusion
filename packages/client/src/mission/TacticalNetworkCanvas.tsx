import { useEffect, useRef, useState } from 'react';
import { Application, Graphics } from 'pixi.js';
import { Crosshair, Lock, LogOut, Radio, ShieldAlert, Wifi } from 'lucide-react';
import type { MissionSession, NetNodeState, NodeType } from '@intrusion/shared';

const HEX_W = 128;
const HEX_H = 64;

function isoProject(x: number, y: number): { ix: number; iy: number } {
  return {
    ix: (x - y) * (HEX_W * 0.65),
    iy: (x + y - 10) * (HEX_H * 0.62),
  };
}

function getNodeSprite(type: NodeType): string {
  switch (type) {
    case 'Entrance':
      return '/assets/img/sprites/node_entrance.png';
    case 'Gateway':
    case 'TutoFirewall':
      return '/assets/img/sprites/node_firewall.png';
    case 'Printer':
      return '/assets/img/sprites/node_printer.png';
    case 'Database':
    case 'CrimeDatabase':
      return '/assets/img/sprites/node_db.png';
    case 'LockServer':
      return '/assets/img/sprites/node_lock.png';
    case 'LockServerLight':
      return '/assets/img/sprites/node_locklight.png';
    case 'Alarm':
      return '/assets/img/sprites/node_alarm.png';
    case 'Treasure':
      return '/assets/img/sprites/node_treasure.png';
    case 'TerminalMul':
    case 'GameServer':
      return '/assets/img/sprites/node_rackuser.png';
    case 'Camera':
    case 'Keypad':
    case 'BigDisplay':
    case 'Tv':
      return '/assets/img/sprites/node_rackgeneric.png';
    default:
      return '/assets/img/sprites/node_terminal.png';
  }
}

interface TacticalNetworkCanvasProps {
  session: MissionSession;
  renderTick: number;
  onSelectNode: (node: NetNodeState) => void;
  onConnectNode: (node: NetNodeState) => void;
}

export function TacticalNetworkCanvas({
  session,
  renderTick,
  onSelectNode,
  onConnectNode,
}: TacticalNetworkCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pixiHostRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 800, h: 500 });
  const dragRef = useRef<{ active: boolean; sx: number; sy: number; px: number; py: number }>({
    active: false,
    sx: 0,
    sy: 0,
    px: 0,
    py: 0,
  });

  const panRef = useRef(pan);
  panRef.current = pan;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Observe container dimensions
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) {
        setSize({ w: r.width, h: r.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // PixiJS v8 HiDPI Background, Grid, Vector Links & Data Particles
  useEffect(() => {
    const mount = pixiHostRef.current;
    if (!mount) return;

    let cancelled = false;
    const app = new Application();

    void (async () => {
      await app.init({
        resizeTo: mount,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        antialias: true,
        backgroundColor: 0x0a0e08,
      });
      if (cancelled) {
        app.destroy(true);
        return;
      }
      mount.replaceChildren(app.canvas);

      const gridGfx = new Graphics();
      const linkGfx = new Graphics();
      app.stage.addChild(gridGfx);
      app.stage.addChild(linkGfx);

      let phase = 0;
      app.ticker.add((ticker) => {
        phase += ticker.deltaTime * 0.025;
        const s = sessionRef.current;
        const p = panRef.current;
        const cx = app.screen.width * 0.5 + p.x;
        const cy = app.screen.height * 0.5 + p.y;

        // 1. Subtle isometric matrix grid
        gridGfx.clear();
        const step = 48;
        for (let gx = -800; gx <= 800; gx += step) {
          gridGfx.moveTo(cx + gx, 0).lineTo(cx + gx, app.screen.height);
        }
        for (let gy = -600; gy <= 600; gy += step) {
          gridGfx.moveTo(0, cy + gy).lineTo(app.screen.width, cy + gy);
        }
        gridGfx.stroke({ width: 1, color: 0x182212, alpha: 0.65 });

        // 2. Network edges & animated signal pulses
        linkGfx.clear();
        const drawnPairs = new Set<string>();
        const nodes = Object.values(s.nodes);

        for (const n of nodes) {
          const a = isoProject(n.x, n.y);
          for (const lid of n.links) {
            const pairKey = n.id < lid ? `${n.id}-${lid}` : `${lid}-${n.id}`;
            if (drawnPairs.has(pairKey)) continue;
            drawnPairs.add(pairKey);
            const peer = s.nodes[lid];
            if (!peer) continue;
            const b = isoProject(peer.x, peer.y);

            const reachable = s.canReachNode(n) && s.canReachNode(peer);
            const isAlarm = s.alarmRemainingSec !== null;
            const color = isAlarm
              ? 0xff5555
              : reachable
                ? 0x58f287
                : s.init.mission.color || 0x4b5835;
            const alpha = reachable ? 0.78 : 0.35;

            linkGfx
              .moveTo(cx + a.ix, cy + a.iy)
              .lineTo(cx + b.ix, cy + b.iy)
              .stroke({ width: reachable ? 2.5 : 1.5, color, alpha });

            // Animated packet pulse along reachable links
            if (reachable) {
              const t = (phase + (n.id * 0.17)) % 1;
              const px = cx + a.ix + (b.ix - a.ix) * t;
              const py = cy + a.iy + (b.iy - a.iy) * t;
              linkGfx.circle(px, py, 2.6).fill({ color: isAlarm ? 0xff8888 : 0xfed82a, alpha: 0.9 });
            }
          }
        }

        // 3. Alarm radar ring around alarm origin
        if (s.alarmOriginNodeId !== null && s.nodes[s.alarmOriginNodeId]) {
          const an = s.nodes[s.alarmOriginNodeId];
          const ap = isoProject(an.x, an.y);
          const radius = 22 + ((phase * 35) % 55);
          const ringAlpha = Math.max(0, 1 - (radius - 22) / 55);
          linkGfx
            .circle(cx + ap.ix, cy + ap.iy, radius)
            .stroke({ width: 2, color: 0xff4444, alpha: ringAlpha });
        }
      });
    })();

    return () => {
      cancelled = true;
      try {
        app.destroy(true);
      } catch {}
    };
  }, []);

  const cx = size.w * 0.5 + pan.x;
  const cy = size.h * 0.5 + pan.y;

  // Visible interactive nodes (non-Empty)
  const interactiveNodes = Object.values(session.nodes).filter((n) => n.type !== 'Empty');

  return (
    <div
      ref={hostRef}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        dragRef.current = {
          active: true,
          sx: e.clientX,
          sy: e.clientY,
          px: pan.x,
          py: pan.y,
        };
      }}
      onPointerMove={(e) => {
        if (!dragRef.current.active) return;
        setPan({
          x: dragRef.current.px + (e.clientX - dragRef.current.sx),
          y: dragRef.current.py + (e.clientY - dragRef.current.sy),
        });
      }}
      onPointerUp={() => {
        dragRef.current.active = false;
      }}
      onPointerLeave={() => {
        dragRef.current.active = false;
      }}
      data-tick={renderTick}
      className="relative h-full w-full select-none overflow-hidden bg-[#0a0e08] cursor-grab active:cursor-grabbing"
    >
      {/* PixiJS v8 HiDPI Canvas Layer */}
      <div ref={pixiHostRef} className="absolute inset-0" />

      {/* Top-Right Camera Controls */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPan({ x: 0, y: 0 })}
          className="cyber-btn flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] cursor-pointer"
        >
          <Crosshair className="h-3.5 w-3.5 text-[#fed82a]" />
          Recentrer Carte
        </button>
      </div>

      {/* Crisp HiDPI Node Overlay Layer */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {interactiveNodes.map((node) => {
          const { ix, iy } = isoProject(node.x, node.y);
          const x = cx + ix;
          const y = cy + iy;
          const reachable = session.canReachNode(node);
          const shielded = session.isNodeShielded(node);
          const crashed = node.system?.crashed ?? false;
          const corrupted = node.system?.corrupted ?? false;
          const isEntrance = node.type === 'Entrance';
          const isTarget = node.isMissionTarget;

          const label = isEntrance
            ? session.missionObjectiveCompleted
              ? 'EXIT // VALIDER MISSION'
              : 'POINT D’ENTRÉE (QUITTER)'
            : !node.visible
              ? 'HÔTE INCONNU [???]'
              : node.system?.name ?? node.type;

          return (
            <button
              key={node.id}
              type="button"
              onClick={() => {
                onSelectNode(node);
                onConnectNode(node);
              }}
              style={{
                transform: `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`,
              }}
              className={`pointer-events-auto group absolute flex flex-col items-center transition duration-150 cursor-pointer ${
                !reachable && !isEntrance ? 'opacity-65 hover:opacity-95' : 'hover:scale-105'
              }`}
            >
              {/* Status Badges */}
              <div className="mb-1 flex items-center gap-1">
                {isTarget && node.visible && (
                  <span className="animate-pulse rounded bg-[#fed82a] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#14190e]">
                    CIBLE
                  </span>
                )}
                {shielded && (
                  <span className="flex items-center gap-0.5 rounded bg-sky-600/90 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">
                    <Lock className="h-2.5 w-2.5" /> VERROU
                  </span>
                )}
                {node.type === 'Alarm' && !crashed && !corrupted && (
                  <span className="flex items-center gap-0.5 rounded bg-rose-600/90 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">
                    <Radio className="h-2.5 w-2.5" /> ALARME
                  </span>
                )}
              </div>

              {/* Sprite Pod */}
              <div
                className={`relative flex h-14 w-14 items-center justify-center rounded-lg border-2 bg-[#12180e]/90 p-1.5 shadow-lg ${
                  isEntrance && session.missionObjectiveCompleted
                    ? 'border-[#58f287] shadow-[#58f287]/30 animate-bounce'
                    : crashed
                      ? 'border-rose-500/60 bg-rose-950/50 grayscale'
                      : corrupted
                        ? 'border-emerald-400/80 bg-emerald-950/40'
                        : reachable
                          ? 'border-[#fed82a]/80 group-hover:border-[#58f287]'
                          : 'border-[#3c492a]'
                }`}
              >
                <img
                  src={getNodeSprite(node.type)}
                  alt={node.type}
                  className="h-10 w-10 object-contain"
                />
                {isEntrance && (
                  <LogOut className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-[#fed82a] p-0.5 text-[#14190e]" />
                )}
                {!isEntrance && reachable && !crashed && !shielded && (
                  <Wifi className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-[#1a2414] p-0.5 text-[#58f287]" />
                )}
                {crashed && (
                  <ShieldAlert className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-rose-950 p-0.5 text-rose-400" />
                )}
              </div>

              {/* Crisp HiDPI Label */}
              <span
                className={`mt-1.5 whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[11px] font-semibold shadow ${
                  isEntrance && session.missionObjectiveCompleted
                    ? 'border-[#58f287] bg-[#132919] text-[#58f287]'
                    : crashed
                      ? 'border-rose-800/60 bg-[#1e1010] text-rose-300 line-through'
                      : corrupted
                        ? 'border-emerald-600/60 bg-[#112416] text-emerald-300'
                        : reachable
                          ? 'border-[#4b5b34] bg-[#141b0f]/95 text-[#eef4d8]'
                          : 'border-[#2c361e] bg-[#0e130b]/90 text-[#869365]'
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
