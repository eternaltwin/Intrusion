import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatVirusDesc, type VirusDef } from '@intrusion/shared';

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
  children,
}: {
  viruses: VirusDef[];
  children: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const onMove = (e: MouseEvent | WheelEvent) => {
      const el = tooltipRef.current;
      if (!el) return;
      const maxLeft = Math.max(20, document.documentElement.clientWidth - 280);
      const x = Math.min(e.pageX + 20, maxLeft);
      const y = e.pageY + 20;
      el.style.position = 'absolute';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('wheel', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('wheel', onMove);
    };
  }, []);

  const activeVirus = activeId ? virusMap.get(activeId) : undefined;

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
