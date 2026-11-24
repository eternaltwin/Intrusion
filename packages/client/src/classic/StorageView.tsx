import { useEffect, useState, type FormEvent } from 'react';
import type { PlayerDto, ValuableDef } from '@intrusion/shared';
import { api, type StorageResponse } from '../api/client';
import { parseCineEmbed, SafeHtml } from '../components/SafeHtml';

type StorageTab = 'packs' | 'misc' | 'cards';

export function StorageView({
  player,
  valuables,
  onPlayerUpdate,
  onNotify,
}: {
  player: PlayerDto;
  valuables: ValuableDef[];
  onPlayerUpdate: (p: PlayerDto) => void;
  onNotify: (msg: string, error?: boolean) => void;
}) {
  const [tab, setTab] = useState<StorageTab>('packs');
  const [storage, setStorage] = useState<StorageResponse | null>(null);
  const [sellCounts, setSellCounts] = useState<Record<string, number>>({});
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [cardNumberInput, setCardNumberInput] = useState('');

  const loadStorage = async () => {
    try {
      const res = await api.storage();
      setStorage(res);
      if (res.files.length > 0 && !selectedFileId) {
        setSelectedFileId(res.files[0].id);
      }
    } catch (err: any) {
      onNotify(err.message || 'Erreur lors de la lecture du disque dur.', true);
    }
  };

  useEffect(() => {
    loadStorage();
  }, []);

  const handleSellPack = async (e: FormEvent, valuableId: string, maxSell: number) => {
    e.preventDefault();
    if (maxSell <= 0) return;
    const qty = Math.max(1, Math.min(maxSell, sellCounts[valuableId] ?? maxSell));
    if (qty <= 0) return;
    try {
      const res = await api.sellPack(valuableId, qty);
      onPlayerUpdate(res.player);
      setStorage((prev) =>
        prev ? { ...prev, remainingQuota: res.remainingQuota } : prev
      );
      const nextOwned = res.player.valuables[valuableId] ?? 0;
      const nextMax = Math.min(nextOwned, res.remainingQuota);
      setSellCounts((prev) => {
        const next = { ...prev };
        if (nextMax <= 0) {
          delete next[valuableId];
        } else {
          next[valuableId] = Math.max(1, Math.min(nextMax, prev[valuableId] ?? nextMax));
        }
        return next;
      });
      onNotify(`Vendu : ${res.soldQty} pack(s) pour +${res.totalEarned} crédits !`);
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    try {
      await api.deleteFile(fileId);
      setStorage((prev) => {
        if (!prev) return prev;
        const remaining = prev.files.filter((f) => f.id !== fileId);
        if (selectedFileId === fileId) {
          setSelectedFileId(remaining[0]?.id ?? null);
        }
        return { ...prev, files: remaining };
      });
      onNotify('Fichier supprimé de votre disque dur.');
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const handleUseCardNumber = async (e: FormEvent) => {
    e.preventDefault();
    if (!cardNumberInput.trim()) return;
    try {
      const res = await api.redeemCardByNumber(cardNumberInput.trim());
      onPlayerUpdate(res.player);
      setCardNumberInput('');
      await loadStorage();
      onNotify(`Carte ${res.cardNumber} encaissée : +${res.earned} crédits transférés !`);
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const selectedFile = storage?.files.find((f) => f.id === selectedFileId) ?? storage?.files[0] ?? null;

  return (
    <div className="storage">
      <ul className="tabs">
        <li id="tab_packs" className={tab === 'packs' ? 'active' : ''}>
          <a onClick={() => setTab('packs')}>
            <img src="/img/icons/market.png" alt="" /> Fichiers Pack
          </a>
        </li>
        <li id="tab_misc" className={tab === 'misc' ? 'active' : ''}>
          <a onClick={() => setTab('misc')}>
            <img src="/img/icons/storage.png" alt="" /> Fichiers Divers (
            {storage?.files.length ?? 0})
          </a>
        </li>
        <li id="tab_cards" className={tab === 'cards' ? 'active' : ''}>
          <a onClick={() => setTab('cards')}>
            <img src="/img/icons/money.png" alt="" /> Cartes Bancaires Volées
          </a>
        </li>
      </ul>

      <div className="window">
        <div className="wtitle">
          <img className="wbutton" src="/img/design/pixel.gif" alt="" />
          <span>File_explorer.prg</span>
        </div>

        {tab === 'packs' && (
          <div id="packs" className="container">
            <div className="help">
              <p>
                Cet espace (strictement illégal) vous permet de{' '}
                <strong>revendre sur le marché noir une partie de vos stocks de fichiers PACK</strong>.
                Les prix varient chaque jour : il est donc recommandé d&apos;y jeter souvent un œil.
              </p>
              <p>
                Vous pouvez extraire les fichiers PACK en mission en cliquant dessus, puis en
                choisissant l&apos;action Extraire.
              </p>
            </div>

            <div style={{ margin: '10px 0' }}>
              Vous pouvez encore{' '}
              <strong>
                revendre {storage?.remainingQuota ?? 20} fichiers sur le marché noir aujourd&apos;hui
              </strong>
              , sans risquer d&apos;attirer trop l&apos;attention.
            </div>

            <table className="table market">
              <tbody>
                <tr>
                  <th>Catégorie</th>
                  <th>Offre du jour</th>
                  <th>Mes stocks</th>
                  <th />
                </tr>
                {valuables.map((val) => {
                  const count = player.valuables[val.id] ?? 0;
                  const mult = storage?.marketMultipliers[val.id] ?? 1;
                  const unitPrice = Math.round(val.price * mult);
                  const maxSell = Math.min(count, storage?.remainingQuota ?? 20);
                  const currentInput =
                    maxSell > 0 ? Math.max(1, Math.min(maxSell, sellCounts[val.id] ?? maxSell)) : 1;

                  return (
                    <tr
                      key={val.id}
                      className={`select packs${count === 0 ? ' noStock' : ''}`}
                    >
                      <td className="desc">
                        <div>{val.name}</div>
                      </td>
                      <td className="price">
                        <div className="gameMoney">
                          {unitPrice} <img src="/img/icons/money.png" alt="" />
                        </div>
                      </td>
                      <td className="count">
                        <div>X {count}</div>
                      </td>
                      <td className="act">
                        {maxSell > 0 ? (
                          <form
                            className="packSellAction"
                            onSubmit={(e) => handleSellPack(e, val.id, maxSell)}
                          >
                            <input
                              type="number"
                              className="field"
                              min={1}
                              max={maxSell}
                              aria-label={`Quantité à vendre (${val.name})`}
                              value={currentInput}
                              onChange={(e) =>
                                setSellCounts((prev) => ({
                                  ...prev,
                                  [val.id]: Math.max(1, Math.min(maxSell, Number(e.target.value) || 1)),
                                }))
                              }
                            />
                            <input type="submit" className="button" value="Vendre" />
                          </form>
                        ) : (
                          <span className="packSellAction">
                            <span className="offButton">Vendre</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'misc' && (
          <div id="misc" className="container">
            <div className="help" style={{ marginBottom: 10 }}>
              Retrouvez ici tous les documents, courriels et journaux copiés à l&apos;aide du virus{' '}
              <strong>Copie (COPY)</strong> lors de vos missions réussies.
            </div>

            {!storage || storage.files.length === 0 ? (
              <p>Aucun fichier copié sur votre disque dur pour le moment.</p>
            ) : (
              <>
                <table className="table files">
                  <tbody>
                    <tr>
                      <th>Fichier</th>
                      <th>Date de capture</th>
                      <th />
                    </tr>
                    {storage.files.map((f) => (
                      <tr
                        key={f.id}
                        className="select"
                        style={{
                          cursor: 'pointer',
                          outline: selectedFile?.id === f.id ? '1px solid #fed82a' : undefined,
                        }}
                        onClick={() => setSelectedFileId(f.id)}
                      >
                        <td>
                          <strong>{f.name}</strong>
                        </td>
                        <td>{f.copiedAt}</td>
                        <td style={{ width: 80 }}>
                          <a
                            className="button"
                            style={{ width: 70, margin: 0 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteFile(f.id);
                            }}
                          >
                            Supprimer
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="viewer">
                  {selectedFile && (() => {
                    const cine = parseCineEmbed(selectedFile.embed);
                    return (
                      <div className="sidePanel">
                        <h1>{selectedFile.name}</h1>
                        {cine && (
                          <div className="pic" style={{ marginBottom: 8 }}>
                            {cine.kind === 'image' && cine.href ? (
                              <a href={cine.href} target="_blank" rel="noreferrer" className="pic">
                                <img
                                  src={cine.src}
                                  alt={selectedFile.name}
                                  style={{ maxWidth: '100%', border: '1px solid #71754c' }}
                                />
                              </a>
                            ) : (
                              <img
                                src={cine.src}
                                alt={selectedFile.name}
                                style={{ maxWidth: '100%', border: '1px solid #71754c' }}
                              />
                            )}
                          </div>
                        )}
                        <SafeHtml html={selectedFile.content} />
                      </div>
                    );
                  })()}
                </div>
                <div className="clear" />
              </>
            )}
          </div>
        )}

        {tab === 'cards' && (
          <div id="cards" className="container">
            <div className="creditCard">
              <form onSubmit={handleUseCardNumber}>
                <label htmlFor="number">Numéro de carte bancaire volée : </label>
                <input
                  id="number"
                  type="text"
                  className="field"
                  name="number"
                  placeholder="ex: 4971-XXXX-XXXX-XXXX"
                  value={cardNumberInput}
                  onChange={(e) => setCardNumberInput(e.target.value)}
                  style={{ width: 200, marginRight: 8 }}
                />
                <input type="submit" className="button" value="Utiliser" style={{ width: 90 }} />
              </form>
            </div>

            <div className="help">
              <p>
                En mission, soyez attentif : vous pouvez récupérer des informations bancaires dans
                les courriels et documents (<em>carte_bancaire.doc</em>, reçus d&apos;achats...) de
                vos cibles à partir du Niveau 4.
              </p>
              <p>
                Notez ou copiez le fichier avec <strong>COPY</strong>, puis entrez ci-dessus le
                numéro de carte bancaire volée pour récupérer des{' '}
                <img src="/img/icons/money.png" alt="" /> !
              </p>
            </div>

            {storage && storage.cards.some((c) => c.redeemed === 1) && (
              <div style={{ marginTop: 15 }}>
                <h1>Historique des cartes encaissées</h1>
                <table className="table">
                  <tbody>
                    <tr>
                      <th>Numéro</th>
                      <th>Société / Cible</th>
                      <th>Montant</th>
                    </tr>
                    {storage.cards
                      .filter((c) => c.redeemed === 1)
                      .map((c) => (
                        <tr key={c.id}>
                          <td>{c.number}</td>
                          <td>{c.holder}</td>
                          <td>
                            <span className="gameMoney">
                              +{c.amount} <img src="/img/icons/money.png" alt="" />
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
