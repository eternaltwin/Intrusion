import { useEffect, useState } from 'react';
import { CreditCard, FileText, Package, Trash2, TrendingUp } from 'lucide-react';
import type { PlayerDto, SimpleFile } from '@intrusion/shared';
import { api, type CatalogResponse, type StorageResponse } from '../api/client';
import { parseCineEmbed, SafeHtml } from '../components/SafeHtml';

interface HardDriveAppProps {
  player: PlayerDto;
  catalog: CatalogResponse;
  onPlayerUpdate: (p: PlayerDto) => void;
}

export function HardDriveApp({ player, catalog, onPlayerUpdate }: HardDriveAppProps) {
  const [data, setData] = useState<StorageResponse | null>(null);
  const [tab, setTab] = useState<'packs' | 'files' | 'cards'>('packs');
  const [selectedFile, setSelectedFile] = useState<Required<SimpleFile> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await api.storage();
      setData(res);
      setSelectedFile((prev) => {
        if (prev) {
          return res.files.find((f) => f.id === prev.id) ?? res.files[0] ?? null;
        }
        return res.files[0] ?? null;
      });
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la lecture du disque dur.');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleSellPack(valId: string, qty: number) {
    setMessage(null);
    setError(null);
    try {
      const res = await api.sellPack(valId, qty);
      onPlayerUpdate(res.player);
      setMessage(`Vendu ${res.soldQty} pack(s) pour +${res.totalEarned} CR.`);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la vente des packs.');
    }
  }

  async function handleRedeemCard(cardId: string) {
    setMessage(null);
    setError(null);
    try {
      const res = await api.redeemCard(cardId);
      onPlayerUpdate(res.player);
      setMessage(`Transfert offshore effectué : +${res.earned} CR.`);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Erreur lors de l’encaissement de la carte.');
    }
  }

  async function handleDeleteFile(fileId: string) {
    setError(null);
    try {
      await api.deleteFile(fileId);
      if (selectedFile?.id === fileId) setSelectedFile(null);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la suppression du fichier.');
    }
  }

  const ownedPackEntries = Object.entries(player.valuables)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({
      id,
      count,
      def: catalog.valuables.find((v) => v.id === id),
    }))
    .filter((x) => Boolean(x.def));

  return (
    <div className="cyber-card flex h-full flex-col overflow-hidden rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#343f24] bg-[#1a2213] px-4 py-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('packs')}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-xs cursor-pointer ${
              tab === 'packs'
                ? 'bg-[#fed82a] font-bold text-[#14190e]'
                : 'bg-[#252f1b] text-[#a7b483]'
            }`}
          >
            <Package className="h-3.5 w-3.5" />
            Marché Noir ({ownedPackEntries.reduce((a, b) => a + b.count, 0)})
          </button>

          <button
            type="button"
            onClick={() => setTab('files')}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-xs cursor-pointer ${
              tab === 'files'
                ? 'bg-[#fed82a] font-bold text-[#14190e]'
                : 'bg-[#252f1b] text-[#a7b483]'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Fichiers Copiés ({data?.files.length ?? 0})
          </button>

          <button
            type="button"
            onClick={() => setTab('cards')}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-xs cursor-pointer ${
              tab === 'cards'
                ? 'bg-[#fed82a] font-bold text-[#14190e]'
                : 'bg-[#252f1b] text-[#a7b483]'
            }`}
          >
            <CreditCard className="h-3.5 w-3.5" />
            Cartes Volées ({data?.cards.filter((c) => !c.redeemed).length ?? 0})
          </button>
        </div>

        {data && tab === 'packs' && (
          <div className="font-mono text-xs text-[#b5c291]">
            Quota recel aujourd&apos;hui :{' '}
            <strong className="text-[#fed82a]">
              {data.remainingQuota} / {data.dailyQuota}
            </strong>{' '}
            packs restants
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-2 font-mono text-xs text-rose-200">
          {error}
        </div>
      )}

      {message && (
        <div className="mx-4 mt-3 rounded border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 font-mono text-xs text-emerald-200">
          {message}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'packs' && (
          <div className="space-y-3">
            {ownedPackEntries.length === 0 ? (
              <div className="py-12 text-center font-mono text-sm text-[#7f8c5e]">
                Aucun pack de données sur votre disque dur. Utilisez l&apos;action <strong>Extraire</strong> sur les fichiers <code>.pack</code> en mission !
              </div>
            ) : (
              ownedPackEntries.map(({ id, count, def }) => {
                const mult = data?.marketMultipliers[id] ?? 1.0;
                const unitPrice = Math.round(def!.price * mult);
                const maxSell = Math.min(count, data?.remainingQuota ?? 20);
                return (
                  <div
                    key={id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded border border-[#3a4628] bg-[#141a0f] px-4 py-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 font-mono text-sm font-bold text-[#e8efd0]">
                        {def!.name}
                        {def!.rare && (
                          <span className="rounded bg-purple-900/60 px-1.5 py-0.5 text-[10px] text-purple-200">
                            RARE
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-3 font-mono text-xs text-[#98a675]">
                        <span>En stock : {count}</span>
                        <span className="flex items-center gap-1 text-[#fed82a]">
                          <TrendingUp className="h-3.5 w-3.5" />
                          Cours du jour : {unitPrice} CR/u ({Math.round(mult * 100)}%)
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2 font-mono text-xs">
                      <button
                        type="button"
                        disabled={maxSell < 1}
                        onClick={() => handleSellPack(id, 1)}
                        className="cyber-btn rounded px-3 py-1.5 cursor-pointer disabled:opacity-40"
                      >
                        Vendre ×1 (+{unitPrice} CR)
                      </button>
                      {maxSell > 1 && (
                        <button
                          type="button"
                          onClick={() => handleSellPack(id, maxSell)}
                          className="cyber-btn-amber rounded px-3 py-1.5 cursor-pointer"
                        >
                          Tout vendre ×{maxSell} (+{unitPrice * maxSell} CR)
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === 'files' && (
          <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="divide-y divide-[#27301b] rounded border border-[#343f24] bg-[#11160d] lg:col-span-5">
              {!data || data.files.length === 0 ? (
                <div className="p-8 text-center font-mono text-xs text-[#7f8c5e]">
                  Aucun fichier copié en dehors des objectifs de mission.
                </div>
              ) : (
                data.files.map((f) => (
                  <div
                    key={f.id}
                    onClick={() => setSelectedFile(f)}
                    className={`flex items-center justify-between px-3.5 py-2.5 font-mono text-xs cursor-pointer ${
                      selectedFile?.id === f.id ? 'bg-[#26311b] text-[#fed82a]' : 'hover:bg-[#192012]'
                    }`}
                  >
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteFile(f.id);
                      }}
                      className="rounded p-1 text-rose-400 hover:bg-rose-950/50"
                      aria-label={`Supprimer ${f.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="rounded border border-[#343f24] bg-[#0e130b] p-4 lg:col-span-7">
              {selectedFile ? (() => {
                const cine = parseCineEmbed(selectedFile.embed);
                return (
                  <div>
                    <div className="mb-3 border-b border-[#2b351e] pb-2 font-mono text-sm font-bold text-[#fed82a]">
                      {selectedFile.name}
                    </div>
                    {cine && (
                      <div className="mb-3 rounded border border-[#3d4b2a] bg-[#12180e] p-3 text-center font-mono">
                        {cine.kind === 'image' && cine.href ? (
                          <a href={cine.href} target="_blank" rel="noreferrer" className="inline-block">
                            <img
                              src={cine.src}
                              alt={selectedFile.name}
                              className="mx-auto max-h-48 rounded border border-[#495933] object-contain"
                            />
                          </a>
                        ) : (
                          <img
                            src={cine.src}
                            alt={selectedFile.name}
                            className="mx-auto max-h-48 rounded border border-[#495933] object-contain"
                          />
                        )}
                        <div className="mt-1.5 text-[10px] text-[#7be082]">
                          {cine.kind === 'video' ? 'FLUX VIDÉO' : 'CAPTURE IMAGE'} // {selectedFile.name}
                        </div>
                      </div>
                    )}
                    <SafeHtml html={selectedFile.content} className="text-sm leading-relaxed" />
                  </div>
                );
              })() : (
                <div className="flex h-full items-center justify-center font-mono text-xs text-[#7f8c5e]">
                  Sélectionnez un fichier pour lire son contenu.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'cards' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {!data || data.cards.length === 0 ? (
              <div className="col-span-full py-12 text-center font-mono text-sm text-[#7f8c5e]">
                Aucune carte bancaire interceptée. Inspectez les fichiers <code>.mail</code> et <code>.doc</code> sur les réseaux infiltrés !
              </div>
            ) : (
              data.cards.map((card) => (
                <div
                  key={card.id}
                  className="flex items-center justify-between rounded border border-[#3e4b2b] bg-[#141a0f] p-4 font-mono"
                >
                  <div>
                    <div className="text-xs text-[#8f9d6d]">{card.holder}</div>
                    <div className="mt-0.5 text-sm font-bold tracking-wider text-[#e8efd0]">
                      {card.number}
                    </div>
                    <div className="mt-1 text-xs text-[#7be082]">Solde : {card.amount} CR</div>
                  </div>
                  {card.redeemed ? (
                    <span className="rounded bg-[#222b18] px-2.5 py-1 text-xs text-[#7d8a5c]">
                      Encaissée
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRedeemCard(card.id)}
                      className="cyber-btn-amber rounded px-3 py-1.5 text-xs cursor-pointer"
                    >
                      Siphonner (+{card.amount} CR)
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
