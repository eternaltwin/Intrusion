import { useEffect, useRef } from 'react';
import type { MissionEndSummary, MissionInitParams } from '@intrusion/shared';

interface EngineRawSummary {
  success: boolean;
  kills: number;
  remainingSec: number;
  valuables: string[];
  copiedFiles: Array<{ name: string; content: string; embed: string | null }>;
  goals: Record<string, number>;
}

declare global {
  interface Window {
    __INTRUSION_CONFIG__?: MissionInitParams;
    __INTRUSION_ON_END__?: (raw: EngineRawSummary) => void;
    IntrusionEngine?: {
      mount: (canvas: HTMLCanvasElement) => void;
      unmount: () => void;
      nextTutoStep?: () => void;
      anotherTip?: () => void;
    };
  }
}

const CUSTOM_FONT_FAMILIES = ['3', '6', '13', '34', '38', '97', '134', '194', '197', '202', '213'];

async function preloadGameFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500));
  const loader = (async () => {
    await Promise.allSettled(
      CUSTOM_FONT_FAMILIES.map((family) => document.fonts.load(`12px "${family}"`))
    );
    await document.fonts.ready;
  })();
  await Promise.race([loader, timeout]);
}

export function MissionPlayView({
  init,
  onComplete,
  onQuit,
}: {
  init: MissionInitParams;
  onComplete: (summary: MissionEndSummary) => void;
  onQuit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    completedRef.current = false;

    window.__INTRUSION_CONFIG__ = init;
    window.__INTRUSION_ON_END__ = (raw: EngineRawSummary) => {
      if (completedRef.current) return;
      completedRef.current = true;

      const remSec = Math.max(0, Math.floor(raw.remainingSec ?? 0));
      const kills = Math.max(0, Math.floor(raw.kills ?? 0));
      const valuables = Array.isArray(raw.valuables) ? raw.valuables : [];
      const score = raw.success
        ? 1000 + remSec * 5 + kills * 40 + valuables.length * 100
        : kills * 15;

      const summary: MissionEndSummary = {
        missionKey: init.missionKey,
        seed: init.seed,
        gl: init.gl,
        isChallenge: init.isChallenge,
        scoutRun: init.chipset === 'scout',
        success: Boolean(raw.success),
        kills,
        remainingSec: remSec,
        valuables,
        copiedFiles: (raw.copiedFiles ?? []).map((f) => ({
          name: f.name,
          content: f.content,
          embed: f.embed ?? null,
        })),
        stolenCards: [],
        goals: raw.goals ?? {},
        score,
      };

      onComplete(summary);
    };

    (async () => {
      await preloadGameFonts();
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (canvas && window.IntrusionEngine) {
        window.IntrusionEngine.mount(canvas);
      }
    })();

    return () => {
      cancelled = true;
      window.__INTRUSION_ON_END__ = undefined;
      window.__INTRUSION_CONFIG__ = undefined;
      if (window.IntrusionEngine) {
        window.IntrusionEngine.unmount();
      }
    };
  }, [init]);

  const closeTip = () => {
    const box = document.getElementById('clientTip');
    if (box) box.style.display = 'none';
  };

  return (
    <div className="window screens">
      <div className="wtitle">
        <img
          className="wbutton"
          src="/img/design/pixel.gif"
          alt="Quitter"
          title="Quitter vers les missions"
          onClick={onQuit}
        />
        <span>
          intrusion.prg -- connect={init.seed} ({init.mission.corp})
        </span>
      </div>

      <div className="container">
        <div className="client">
          <div className="sidePanel">
            <div id="tutorial" />
            <div id="clientTip">
              <a className="close" onClick={closeTip}>
                Fermer
              </a>
              <div className="box" id="clientTipContent" />
            </div>
            <div id="sideContent" />
          </div>

          <div className="swf" id="swf_game">
            <canvas id="main" ref={canvasRef} />
          </div>

          <div className="briefingPanel">
            <div id="briefingContent" />
          </div>
        </div>
      </div>
    </div>
  );
}
