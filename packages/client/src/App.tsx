import { useCallback, useEffect, useState } from 'react';
import { getAdjustedPrime, type MissionEndSummary, type MissionInitParams, type PlayerDto } from '@intrusion/shared';
import { api, type CatalogResponse } from './api/client';
import { VirusTooltipProvider } from './classic/TooltipContext';
import { ClassicLayout, type ClassicRoute } from './classic/ClassicLayout';
import { AuthView } from './classic/AuthView';
import { MissionsView } from './classic/MissionsView';
import { MissionPlayView } from './classic/MissionPlayView';
import { MissionEndView, type DebriefState } from './classic/MissionEndView';
import { DecksView } from './classic/DecksView';
import { StoreView } from './classic/StoreView';
import { StorageView } from './classic/StorageView';
import { ChallengeView } from './classic/ChallengeView';
import { ProfileView } from './classic/ProfileView';
import { GuideView } from './classic/GuideView';
import { OptionsView } from './classic/OptionsView';

function runTransition(update: () => void) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => void;
  };
  if (
    typeof doc.startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    doc.startViewTransition(update);
  } else {
    update();
  }
}

export function App() {
  const [player, setPlayer] = useState<PlayerDto | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [booting, setBooting] = useState(true);
  const [route, setRoute] = useState<ClassicRoute>('missions');
  const [missionTab, setMissionTab] = useState<'ongoing' | 'available' | 'tutorial' | 'completed'>('available');
  const [activeMission, setActiveMission] = useState<MissionInitParams | null>(null);
  const [debrief, setDebrief] = useState<DebriefState | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const notify = useCallback((text: string, error = false) => {
    setNotice({ text, error });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    (async () => {
      try {
        const [{ player: me }, cat] = await Promise.all([api.me(), api.catalog('fr')]);
        setPlayer(me);
        setCatalog(cat);
        if (me && me.settings.lang === 'en') {
          const enCat = await api.catalog('en');
          setCatalog(enCat);
        }
      } catch (err: any) {
        notify(err.message || 'Erreur d’initialisation.', true);
      } finally {
        setBooting(false);
      }
    })();
  }, [notify]);

  const handlePlayerUpdate = useCallback(
    async (next: PlayerDto) => {
      if (!next) return;
      setPlayer(next);
      if (catalog && next.settings.lang !== catalog.lang) {
        try {
          const nextCat = await api.catalog(next.settings.lang);
          setCatalog(nextCat);
        } catch {
          // keep current catalog if network hiccup
        }
      }
    },
    [catalog]
  );

  const navigate = useCallback((nextRoute: ClassicRoute) => {
    runTransition(() => {
      setActiveMission(null);
      setDebrief(null);
      setNotice(null);
      setRoute(nextRoute);
    });
  }, []);

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    setActiveMission(null);
    setDebrief(null);
    setPlayer(null);
  };

  const handleStartMission = async (missionKey: string) => {
    try {
      setNotice(null);
      const res = await api.startMission(missionKey);
      setDebrief(null);
      setActiveMission(res.init);
    } catch (err: any) {
      notify(err.message || 'Impossible de démarrer la mission.', true);
    }
  };

  const handleStartChallenge = async () => {
    try {
      setNotice(null);
      const res = await api.startChallenge();
      setDebrief(null);
      setActiveMission(res.init);
    } catch (err: any) {
      notify(err.message || 'Impossible de démarrer le challenge.', true);
    }
  };

  const handleCompleteMission = async (summary: MissionEndSummary) => {
    if (!player || !activeMission) return;
    const prevLevel = player.level;
    const prevTries = activeMission.tries;
    const basePrime = activeMission.mission.prime;

    try {
      if (summary.isChallenge) {
        const res = await api.endChallenge(summary);
        setPlayer(res.player);
        setActiveMission(null);
        setDebrief({
          summary,
          earnedMoney: res.rewardMoney,
          earnedXp: res.isRanked && summary.success ? 2 : 0,
          scoutRun: false,
          previousLevel: prevLevel,
          newLevel: res.player.level,
          nextRetryPrime: 0,
          isRankedChallenge: res.isRanked,
        });
      } else {
        const res = await api.endMission(summary.missionKey, summary);
        setPlayer(res.player);
        setActiveMission(null);
        setDebrief({
          summary,
          earnedMoney: res.earnedMoney,
          earnedXp: res.earnedXp,
          scoutRun: res.scoutRun,
          previousLevel: prevLevel,
          newLevel: res.player.level,
          nextRetryPrime: getAdjustedPrime(basePrime, prevTries + 1),
        });
      }
    } catch (err: any) {
      setActiveMission(null);
      notify(err.message || 'Erreur lors de la validation du débriefing.', true);
    }
  };

  if (booting || !catalog) {
    return (
      <ClassicLayout
        player={null}
        route="missions"
        notice={null}
        onNavigate={navigate}
        onLogout={handleLogout}
      >
        <div className="window">
          <div className="wtitle">
            <img className="wbutton" src="/img/design/pixel.gif" alt="" />
            <span>Intrusion.prg</span>
          </div>
          <div className="container">Initialisation du terminal...</div>
        </div>
      </ClassicLayout>
    );
  }

  return (
    <VirusTooltipProvider viruses={catalog.viruses}>
      <ClassicLayout
        player={player}
        route={route}
        notice={notice}
        onNavigate={navigate}
        onLogout={handleLogout}
      >
        {!player ? (
          <AuthView onAuthenticated={handlePlayerUpdate} />
        ) : activeMission ? (
          <MissionPlayView
            init={activeMission}
            onComplete={handleCompleteMission}
            onQuit={() => setActiveMission(null)}
          />
        ) : debrief ? (
          <MissionEndView
            debrief={debrief}
            valuablesCatalog={catalog.valuables}
            virusesCatalog={catalog.viruses}
            onRetry={() => {
              if (debrief.summary.isChallenge) handleStartChallenge();
              else handleStartMission(debrief.summary.missionKey);
            }}
            onOpenDecks={() => navigate('decks')}
            onOpenTutorials={() => {
              setMissionTab('tutorial');
              navigate('missions');
            }}
            onOpenStorage={() => navigate('storage')}
            onFinish={() => {
              const wasChallenge = debrief.summary.isChallenge;
              setDebrief(null);
              setRoute(wasChallenge ? 'challenge' : 'missions');
            }}
          />
        ) : route === 'missions' ? (
          <MissionsView
            player={player}
            chipsets={catalog.chipsets}
            initialTab={missionTab}
            onPlayerUpdate={handlePlayerUpdate}
            onStartMission={handleStartMission}
            onOpenDecks={() => navigate('decks')}
            onNotify={notify}
          />
        ) : route === 'challenge' ? (
          <ChallengeView onStartChallenge={handleStartChallenge} onNotify={notify} />
        ) : route === 'decks' ? (
          <DecksView
            player={player}
            chipsets={catalog.chipsets}
            addDeckCost={catalog.addDeckCost}
            addSlotCost={catalog.addSlotCost}
            onPlayerUpdate={handlePlayerUpdate}
            onNotify={notify}
          />
        ) : route === 'store' ? (
          <StoreView
            player={player}
            viruses={catalog.viruses}
            chipsets={catalog.chipsets}
            biosCosts={catalog.biosCosts}
            onPlayerUpdate={handlePlayerUpdate}
            onNotify={notify}
          />
        ) : route === 'storage' ? (
          <StorageView
            player={player}
            valuables={catalog.valuables}
            onPlayerUpdate={handlePlayerUpdate}
            onNotify={notify}
          />
        ) : route === 'profile' ? (
          <ProfileView player={player} chipsets={catalog.chipsets} />
        ) : route === 'guide' ? (
          <GuideView />
        ) : (
          <OptionsView
            player={player}
            onPlayerUpdate={handlePlayerUpdate}
            onLogout={handleLogout}
            onNotify={notify}
          />
        )}
      </ClassicLayout>
    </VirusTooltipProvider>
  );
}
