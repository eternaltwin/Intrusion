import { useState } from 'react';

type GuideSection = 'basics' | 'systems' | 'viruses' | 'market' | 'leet';

export function GuideView() {
  const [section, setSection] = useState<GuideSection>('basics');

  return (
    <div className="guide">
      <div className="window">
        <div className="wtitle">
          <img className="wbutton" src="/img/design/pixel.gif" alt="" />
          <span>Manuel d&apos;Intrusion // Help.prg</span>
        </div>

        <div className="container">
          <div className="left">
            <ul>
              <li className={section === 'basics' ? 'active' : ''}>
                <a onClick={() => setSection('basics')}>Principes de base</a>
              </li>
              <li className={section === 'systems' ? 'active' : ''}>
                <a onClick={() => setSection('systems')}>Systèmes &amp; Fichiers</a>
              </li>
              <li className={section === 'viruses' ? 'active' : ''}>
                <a onClick={() => setSection('viruses')}>Virus, Combos &amp; Chipsets</a>
              </li>
              <li className={section === 'market' ? 'active' : ''}>
                <a onClick={() => setSection('market')}>Marché Noir &amp; Cartes</a>
              </li>
              <li className={section === 'leet' ? 'active' : ''}>
                <a onClick={() => setSection('leet')}>Mode Uber-Eleet (CLI)</a>
              </li>
            </ul>
          </div>

          <div className="right">
            {section === 'basics' && (
              <>
                <h1>Principes de base</h1>
                <p>
                  Lors de chaque contrat, vous prenez le contrôle d&apos;une passerelle d&apos;entrée
                  connectée au réseau interne d&apos;une organisation cible.
                </p>
                <ul className="large">
                  <li>
                    <strong>Barre Rouge (Intégrité) :</strong> votre santé face aux contre-attaques
                    des antivirus. Si elle tombe à 0, vous êtes éjecté et la mission échoue.
                  </li>
                  <li>
                    <strong>Barre Bleue (Ressources) :</strong> l&apos;énergie mémoire consommée par
                    l&apos;exécution de vos virus. Si elle tombe à 0, vous êtes déconnecté du système
                    courant.
                  </li>
                  <li>
                    <strong>Chronomètre :</strong> chaque réseau dispose d&apos;un temps limité avant
                    traçage complet de votre connexion (le temps continue de s&apos;écouler pendant
                    le chargement de vos virus et dossiers).
                  </li>
                  <li>
                    <strong>Navigation fluide :</strong> cliquez sur un dossier pour l&apos;ouvrir,{' '}
                    <strong>Espace</strong> pour remonter au dossier parent, <strong>Tab</strong> pour
                    cibler rapidement les fichiers, et déconnectez-vous sur la passerelle de sortie
                    une fois l&apos;objectif accompli !
                  </li>
                </ul>
              </>
            )}

            {section === 'systems' && (
              <>
                <h1>Systèmes &amp; Fichiers critiques</h1>
                <table className="table">
                  <tbody>
                    <tr>
                      <td>Noyau (.core)</td>
                      <td>
                        Détruire le fichier noyau fait <strong>crasher</strong> définitivement la
                        machine (désactive aussi les verrous et alarmes liés).
                      </td>
                    </tr>
                    <tr>
                      <td>Contrôle (.ctrl)</td>
                      <td>
                        Corrompre ou pirater le fichier de contrôle vous accorde les droits{' '}
                        <strong>administrateur</strong> sur la machine.
                      </td>
                    </tr>
                    <tr>
                      <td>Journal (.log)</td>
                      <td>
                        Enregistre vos actions suspectes. Effacer les logs empêche le déclenchement
                        des alertes de sécurité lors de votre déconnexion.
                      </td>
                    </tr>
                    <tr>
                      <td>Route (.route)</td>
                      <td>
                        Révèle les machines voisines connectées au système courant sur la carte du
                        réseau.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}

            {section === 'viruses' && (
              <>
                <h1>Virus, Combos &amp; Chipsets</h1>
                <ul className="large">
                  <li>
                    <strong>Dégâts :</strong> détruisent directement les fichiers, verrous et
                    antivirus.
                  </li>
                  <li>
                    <strong>Afflictions :</strong> paralysent, affaiblissent ou désactivent les
                    contre-mesures ennemies.
                  </li>
                  <li>
                    <strong>Points de Combo :</strong> chaque antivirus détruit vous octroie 1 point
                    de combo (jusqu&apos;à 3, ou 5 avec le chipset Combo). Les virus Combo consomment
                    ces points pour déclencher des effets dévastateurs.
                  </li>
                  <li>
                    <strong>Raccourcis Dock :</strong> utilisez les touches <strong>1 à 9</strong> de
                    votre clavier pour lancer instantanément vos virus sur la cible sélectionnée, et{' '}
                    <strong>C</strong> sur la vue réseau pour changer de Deck.
                  </li>
                </ul>
              </>
            )}

            {section === 'market' && (
              <>
                <h1>Marché Noir &amp; Cartes Bancaires Volées</h1>
                <ul className="large">
                  <li>
                    <strong>Fichiers PACK :</strong> certains systèmes contiennent des archives de
                    valeur (musique, films, données secrètes) et des packs d&apos;énergie. Extrayez-les
                    puis revendez-les dans <strong>Disque Dur &rarr; Fichiers Pack</strong> au meilleur
                    taux quotidien.
                  </li>
                  <li>
                    <strong>Virus COPY :</strong> copiez des emails ou documents intéressants pour les
                    conserver dans <strong>Fichiers Divers</strong> après la mission.
                  </li>
                  <li>
                    <strong>Cartes Bancaires :</strong> fouillez les courriels d&apos;achats et
                    fichiers <em>carte_bancaire.doc</em> pour repérer des numéros de cartes, puis
                    encaissez-les dans <strong>Cartes Bancaires Volées</strong> !
                  </li>
                </ul>
              </>
            )}

            {section === 'leet' && (
              <>
                <h1>Mode Uber-Eleet (Ligne de commande)</h1>
                <p>
                  Activé dans <strong>Options</strong>, le mode Uber-Eleet remplace le clic de virus
                  par un véritable shell hacker en bas de l&apos;écran :
                </p>
                <ul className="large">
                  <li>
                    <code>cd nom_dossier</code> ou <code>cd ..</code> : naviguer dans l&apos;arborescence.
                  </li>
                  <li>
                    <code>code_virus nom_fichier</code> (ex : <code>dmgm noyau.core</code>) : lancer
                    un virus instantanément par son identifiant avec auto-complétion <strong>Tab</strong>.
                  </li>
                  <li>
                    <code>alias d = dmgm</code> dans votre fichier <strong>.hackrc</strong> : créer
                    vos propres raccourcis ultra-rapides !
                  </li>
                </ul>
              </>
            )}
          </div>

          <div className="clear" />
        </div>
      </div>
    </div>
  );
}
