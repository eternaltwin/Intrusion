import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { formatVirusDesc, type VirusDef } from '@intrusion/shared';

const CURSOR_OFFSET = 18;
const VIEWPORT_MARGIN = 10;

interface TooltipContextValue {
  showVirus: (virusId: string) => void;
  hideVirus: (virusId?: string) => void;
}

const TooltipContext = createContext<TooltipContextValue>({
  showVirus: () => {},
  hideVirus: () => {},
});

export function useVirusTooltip() {
  return useContext(TooltipContext);
}

export function VirusTooltipProvider({
  viruses,
  resetKey,
  children,
}: {
  viruses: VirusDef[];
  resetKey?: string;
  children: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setActiveId(null);
  }, [resetKey]);

  const virusMap = useMemo(() => {
    const m = new Map<string, VirusDef>();
    for (const v of viruses) m.set(v.id, v);
    return m;
  }, [viruses]);

  const showVirus = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const hideVirus = useCallback((id?: string) => {
    setActiveId((prev) => (!id || prev === id ? null : prev));
  }, []);

  const positionTooltip = useCallback(() => {
    const el = tooltipRef.current;
    const pointer = pointerRef.current;
    if (!el) return;
    if (!pointer) {
      el.style.visibility = 'hidden';
      return;
    }

    const tipWidth = el.offsetWidth;
    const tipHeight = el.offsetHeight;
    if (tipWidth === 0 && tipHeight === 0) return;

    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;

    let x = pointer.x + CURSOR_OFFSET;
    if (x + tipWidth > vw - VIEWPORT_MARGIN) {
      const flippedX = pointer.x - tipWidth - CURSOR_OFFSET;
      x =
        flippedX >= VIEWPORT_MARGIN
          ? flippedX
          : Math.max(VIEWPORT_MARGIN, vw - tipWidth - VIEWPORT_MARGIN);
    }

    let y = pointer.y + CURSOR_OFFSET;
    if (y + tipHeight > vh - VIEWPORT_MARGIN) {
      const flippedY = pointer.y - tipHeight - CURSOR_OFFSET;
      y =
        flippedY >= VIEWPORT_MARGIN
          ? flippedY
          : Math.max(VIEWPORT_MARGIN, vh - tipHeight - VIEWPORT_MARGIN);
    }

    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.visibility = 'visible';
  }, []);

  useEffect(() => {
    const onPointer = (e: MouseEvent | WheelEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      positionTooltip();
    };
    const onResize = () => {
      positionTooltip();
    };

    window.addEventListener('mousemove', onPointer, { passive: true, capture: true });
    window.addEventListener('mouseover', onPointer, { passive: true, capture: true });
    window.addEventListener('wheel', onPointer, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    const el = tooltipRef.current;
    const observer =
      el && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => positionTooltip())
        : null;
    if (el && observer) {
      observer.observe(el);
    }

    return () => {
      window.removeEventListener('mousemove', onPointer, { capture: true });
      window.removeEventListener('mouseover', onPointer, { capture: true });
      window.removeEventListener('wheel', onPointer);
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, [positionTooltip]);

  const activeVirus = activeId ? virusMap.get(activeId) : undefined;

  useLayoutEffect(() => {
    if (activeVirus) {
      positionTooltip();
    }
  }, [activeVirus, positionTooltip]);

  return (
    <TooltipContext.Provider value={{ showVirus, hideVirus }}>
      {children}
      <div
        id="tooltip"
        ref={tooltipRef}
        style={{ display: activeVirus ? 'block' : 'none' }}
      >
        <div className="tiptop">
          <div className="tipbottom">
            <div className="tipbg">
              {activeVirus && (
                <>
                  <img
                    className="vicon"
                    src={`/img/dockicons/xl/${activeVirus.id}.png`}
                    alt={activeVirus.name}
                  />
                  <h1 className="name">
                    {activeVirus.name} <em>({activeVirus.id.toUpperCase()})</em>
                  </h1>
                  <p className="desc" style={{ whiteSpace: 'pre-line' }}>
                    {formatVirusDesc(activeVirus)}
                  </p>
                  <div className="infos">
                    <p>Coût en Ressources : {activeVirus.cc}</p>
                    <p>Niveau requis : {activeVirus.level}</p>
                    {activeVirus.uses !== null && <p>Utilisations max : {activeVirus.uses}</p>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipContext.Provider>
  );
}
