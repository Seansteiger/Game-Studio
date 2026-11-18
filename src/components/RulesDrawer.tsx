import { useEffect } from 'react';
import { BookOpen, Eye, Layers, Lock, Shield, Timer, Trophy, X } from 'lucide-react';

export interface RulesDrawerProps {
  isOpen: boolean;
  sweepsEnabled: boolean;
  onClose: () => void;
}

const SCORE_ROWS = [
  {
    name: 'Most Cards',
    points: '3 pts',
    detail: 'Requires >=21 cards in 2-side modes; 20–20 tie awards 0 pts.',
  },
  {
    name: 'Big Casino (10♦)',
    points: '2 pts',
    detail: 'Captured by holding the Ten of Diamonds at deal end.',
  },
  {
    name: 'Little Casino (2♠)',
    points: '1 pt',
    detail: 'Captured by holding the Two of Spades at deal end.',
  },
  {
    name: 'Most Spades',
    points: '1 pt',
    detail: 'Awarded to the side with the strict majority of spades.',
  },
  {
    name: 'Aces (A♠ A♥ A♦ A♣)',
    points: '1 pt ea',
    detail: 'Each captured Ace scores 1 point (up to 4 pts per deal).',
  },
  {
    name: 'Sweeps (House Rule)',
    points: '+1 pt ea',
    detail: 'Clearing every card from the table (excluding the final card of the deal).',
  },
];

export function RulesDrawer({ isOpen, sweepsEnabled, onClose }: RulesDrawerProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="SA Casino Player Manual"
    >
      <aside
        className="animate-modal-enter relative flex h-full w-full max-w-md flex-col border-l border-[#c89d54]/45 bg-gradient-to-b from-[#25170f] via-[#18100a] to-[#100a06] shadow-[-24px_0_64px_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#c89d54]/25 bg-[#20140d]/95 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#c89d54]/45 bg-[#312014] text-[#e6c588] shadow-inner">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[10px] font-semibold tracking-[0.18em] text-[#c89d54] uppercase">
                Player Manual
              </p>
              <h2 className="font-display text-base font-bold text-[#f6efe2] [text-wrap:balance]">
                SA Casino Guide
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-stone-300 transition-colors hover:border-[#c89d54]/45 hover:bg-white/10 hover:text-white active:scale-[0.96]"
            aria-label="Close manual"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="thin-scroll flex-1 space-y-5 overflow-y-auto px-5 py-4 text-xs leading-relaxed text-stone-300">
          {/* 1. 40-Card Numeral Deck (Ace–10) */}
          <section className="rounded-xl border border-[#c89d54]/20 bg-black/25 p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-[#c89d54]" />
              <h3 className="font-display text-xs font-bold tracking-wider text-[#f3dfb7] uppercase [text-wrap:balance]">
                40-Card Numeral Deck (Ace–10)
              </h3>
            </div>
            <p className="text-[12px] text-stone-300/95 [text-wrap:pretty]">
              South African Casino uses a{' '}
              <span className="font-mono-num font-semibold text-[#f4efe6]">40-card</span> numeral
              deck (<span className="font-mono-num font-semibold text-[#f4efe6]">Ace</span> through{' '}
              <span className="font-mono-num font-semibold text-[#f4efe6]">10</span> only — all{' '}
              <span className="font-mono-num font-semibold text-[#f4efe6]">12</span>{' '}
              <span className="font-mono-num font-semibold text-[#f4efe6]">J, Q, K</span> face cards
              and Jokers are removed). This guarantees that{' '}
              <span className="font-semibold text-[#f3dfb7]">Big Casino (10♦)</span>,{' '}
              <span className="font-semibold text-slate-200">Little Casino (2♠)</span>, all{' '}
              <span className="font-mono-num font-semibold text-emerald-200">4 Aces</span>, and all{' '}
              <span className="font-mono-num font-semibold text-[#f4efe6]">10 Spades</span> are live
              in every single deal. Remaining table cards at deal end go to the last player who
              captured.
            </p>
            <ul className="mt-2.5 space-y-1.5 border-t border-white/8 pt-2.5 text-[11.5px] text-stone-300/90">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c89d54]" />
                <span className="[text-wrap:pretty]">
                  <strong className="text-[#f4efe6]">1v1:</strong> Deals{' '}
                  <span className="font-mono-num">2</span> rounds of{' '}
                  <span className="font-mono-num">10</span> cards each. Loose cards and builds from
                  Round <span className="font-mono-num">1</span> remain live on the felt for Round{' '}
                  <span className="font-mono-num">2</span>.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c89d54]" />
                <span className="[text-wrap:pretty]">
                  <strong className="text-[#f4efe6]">3P FFA:</strong> Deals{' '}
                  <span className="font-mono-num">13</span> cards to each seat plus{' '}
                  <span className="font-mono-num">1</span> face-up starter card on the table.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c89d54]" />
                <span className="[text-wrap:pretty]">
                  <strong className="text-[#f4efe6]">2v2 Partnerships:</strong> Deals{' '}
                  <span className="font-mono-num">10</span> cards per seat; partners sit opposite
                  (South &amp; North vs. West &amp; East) and pool captured piles together.
                </span>
              </li>
            </ul>
          </section>

          {/* 2. Numeral Captures (Ace–10) */}
          <section className="rounded-xl border border-emerald-500/20 bg-[#0b1f16]/70 p-3.5">
            <h3 className="mb-2 font-display text-xs font-bold tracking-wider text-emerald-200 uppercase [text-wrap:balance]">
              Numeral Captures (Ace–10)
            </h3>
            <p className="text-[12px] text-stone-300/95 [text-wrap:pretty]">
              Aces equal <span className="font-mono-num font-semibold text-white">A=1</span>, while{' '}
              <span className="font-mono-num font-semibold text-white">2–10</span> take their face
              value. A numeric card captures any matching ranks, matching builds, and multiple
              disjoint sum groups simultaneously (for example, playing{' '}
              <span className="font-mono-num font-semibold text-emerald-200">9</span> captures{' '}
              <span className="font-mono-num">9</span>, <span className="font-mono-num">5+4</span>,
              and <span className="font-mono-num">6+3</span> at once).
            </p>
            <p className="mt-2 text-[11.5px] text-stone-300/85 [text-wrap:pretty]">
              With all <span className="font-mono-num font-semibold text-[#f4efe6]">12</span>{' '}
              court cards (<span className="font-mono-num font-semibold text-[#f4efe6]">J, Q, K</span>)
              and Jokers removed from the deck, every card in hand participates in numeric sums,
              builds, and captures.
            </p>
          </section>

          {/* 3. Building & Cementing */}
          <section className="rounded-xl border border-[#c89d54]/25 bg-black/25 p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-[#e6c588]" />
              <h3 className="font-display text-xs font-bold tracking-wider text-[#f3dfb7] uppercase [text-wrap:balance]">
                Building &amp; Cementing
              </h3>
            </div>
            <div className="space-y-2 text-[11.5px] text-stone-300/90">
              <p className="[text-wrap:pretty]">
                <strong className="text-[#f4efe6]">Possession Rule:</strong> You must hold a numeric
                card matching the build&apos;s target value in your hand to create or modify it, and
                you may never trail or play away your last cover card while your build sits on the
                table.
              </p>
              <p className="[text-wrap:pretty]">
                <strong className="text-sky-200">Fresh Open Build:</strong> A single sum group
                (such as <span className="font-mono-num">3+4=7</span>). Any player holding the
                higher rank may raise it upward (up to <span className="font-mono-num">10</span>) by
                adding cards.
              </p>
              <p className="flex items-start gap-1.5 [text-wrap:pretty]">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                <span>
                  <strong className="text-amber-200">Cemented Build (LOCKED):</strong> Pairing
                  multiple disjoint groups of the same target value (such as{' '}
                  <span className="font-mono-num">6</span> onto{' '}
                  <span className="font-mono-num">6</span>, or adding{' '}
                  <span className="font-mono-num">2+5</span> to a{' '}
                  <span className="font-mono-num">7</span>) locks the target permanently. It can no
                  longer be raised—only reinforced at the same value or captured.
                </span>
              </p>
            </div>
          </section>

          {/* 4. Tabletop Controls & Special Moves */}
          <section className="rounded-xl border border-[#c89d54]/25 bg-black/25 p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <Eye className="h-3.5 w-3.5 text-[#e6c588]" />
              <h3 className="font-display text-xs font-bold tracking-wider text-[#f3dfb7] uppercase [text-wrap:balance]">
                Tabletop Controls &amp; Special Moves
              </h3>
            </div>
            <div className="space-y-2.5 text-[11.5px] text-stone-300/90">
              <p className="[text-wrap:pretty]">
                <strong className="text-[#f4efe6]">Peeking Builds:</strong> Tap the{' '}
                <span className="font-semibold text-[#f3dfb7]">eye icon</span> on any build stack
                to fan out and see all cards underneath. Locked builds show a{' '}
                <span className="font-semibold text-amber-200">lock icon</span> next to their
                number.
              </p>
              <p className="[text-wrap:pretty]">
                <strong className="text-emerald-200">Digging Opponent&apos;s Captured Deck:</strong>{' '}
                Only the top-most face-up captured card of each opponent&apos;s pile is visible.
                When legal, you can capture that exposed top card directly or dig it onto a matching
                table number or your own active build.
              </p>
              <p className="flex items-start gap-1.5 [text-wrap:pretty]">
                <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#c89d54]" />
                <span>
                  <strong className="text-[#f4efe6]">4-Second Cancel Timer:</strong> After playing a
                  move, you have <span className="font-mono-num font-semibold text-white">4</span>{' '}
                  seconds to cancel and undo it before the next player acts.
                </span>
              </p>
            </div>
          </section>

          {/* 5. Scoring Table */}
          <section className="rounded-xl border border-[#c89d54]/20 bg-black/30 p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy className="h-3.5 w-3.5 text-[#c89d54]" />
                <h3 className="font-display text-xs font-bold tracking-wider text-[#f3dfb7] uppercase [text-wrap:balance]">
                  Deal Scoring (<span className="font-mono-num">11</span> Base Pts)
                </h3>
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  sweepsEnabled
                    ? 'border-emerald-400/45 bg-emerald-950/75 text-emerald-200'
                    : 'border-white/10 bg-white/5 text-stone-400'
                }`}
              >
                Sweeps {sweepsEnabled ? 'Active' : 'Off'}
              </span>
            </div>

            <div className="divide-y divide-white/8">
              {SCORE_ROWS.map((row) => (
                <div key={row.name} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div>
                    <div className="font-semibold text-[#f4efe6]">{row.name}</div>
                    <p className="mt-0.5 text-[11px] text-stone-400 [text-wrap:pretty]">
                      {row.detail}
                    </p>
                  </div>
                  <span className="shrink-0 rounded border border-[#c89d54]/30 bg-[#281b11] px-2 py-0.5 text-[11px] font-mono-num font-bold text-[#e6c588] tabular-nums">
                    {row.points}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#c89d54]/20 bg-[#18100a]/95 px-5 py-3 text-[11px] text-stone-400">
          <span>Click any card or drag onto a table target to play.</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#c89d54]/45 bg-[#2d1d12] px-3 py-1.5 text-xs font-semibold text-[#f3dfb7] transition-colors hover:bg-[#3a2618]"
          >
            Resume Table
          </button>
        </div>
      </aside>
    </div>
  );
}

export default RulesDrawer;
