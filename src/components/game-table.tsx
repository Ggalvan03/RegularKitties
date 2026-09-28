"use client";
import Image from "next/image";
import Link from "next/link";
import { Clock3, Crown, LoaderCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { FOODS, type Food, type PreferenceToken } from "@/lib/game/rules";
import {
  getAnonymousAccessToken,
  getSupabaseBrowserClient,
} from "@/lib/supabase/browser";
import { PLAYER_COLORS, RoomChat } from "@/components/room-chat";
type Powerup =
  | "clear_plate"
  | "move_plate"
  | "change_cat"
  | "steal_for_free"
  | "change_seat";
type Room = {
  id: string;
  join_code: string;
  timer_seconds: number;
  status: string;
};
type Player = {
  id: string;
  user_id: string;
  nickname: string;
  seat: number;
  score?: number;
  is_host: boolean;
};
type Game = { id: string; state_version: number; status: string };
type Round = {
  id: string;
  number: number;
  cat_id: number;
  starter_seat: number;
  active_seat: number;
  phase: "plating" | "stealing" | "round_result" | "finished";
  cycle: number;
  deadline: string;
  steals_taken: number;
};
type Card = {
  id: string;
  food: Food | null;
  powerup: Powerup | null;
  card_kind: "food" | "powerup";
  player_id: string;
  position?: number;
};
type Cat = {
  id: number;
  name: string;
  points: number;
  preference_tokens: PreferenceToken[];
};
const LABELS: Record<Food, string> = {
  chicken: "Chicken",
  milk: "Milk",
  fish: "Fish",
  croquettes: "Croquettes",
};
const POWERUPS: Record<
  Powerup,
  { name: string; description: string; image: string }
> = {
  clear_plate: {
    name: "Clear plate",
    description:
      "Discard every card on one selected plate, including your own.",
    image: "/powerups/clear-plate.png",
  },
  move_plate: {
    name: "Move plate",
    description: "Swap the complete plates of two selected players.",
    image: "/powerups/move-plate.png",
  },
  change_cat: {
    name: "Change cat",
    description: "Reveal a random uncaptured cat without clearing plates.",
    image: "/powerups/change-cat.png",
  },
  steal_for_free: {
    name: "Steal for free",
    description: "Take up to two cards without paying or using normal steals.",
    image: "/powerups/steal-for-free.png",
  },
  change_seat: {
    name: "Change seat",
    description: "Move to the final seat when plating next begins.",
    image: "/powerups/change-seat.png",
  },
};
export function GameTable({
  room,
  players: initialPlayers,
  userId,
  code,
}: {
  room: Room;
  players: Player[];
  userId?: string;
  code: string;
}) {
  const [game, setGame] = useState<Game>();
  const [round, setRound] = useState<Round>();
  const [cat, setCat] = useState<Cat>();
  const [players, setPlayers] = useState(initialPlayers);
  const [hand, setHand] = useState<Card[]>([]);
  const [plates, setPlates] = useState<Card[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState<string>();
  const [powerTargets, setPowerTargets] = useState<string[]>([]);
  const [targetPlayers, setTargetPlayers] = useState<string[]>([]);
  const [reordering, setReordering] = useState(false);
  const [plateOrder, setPlateOrder] = useState<string[]>([]);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shakingSeat, setShakingSeat] = useState<number>();
  const previousActiveSeat = useRef<number | undefined>(undefined);
  const supabase = getSupabaseBrowserClient();
  const activeSeat = round?.active_seat;
  const me =
    players.find((p) => p.id === hand[0]?.player_id) ??
    players.find((p) => p.user_id === userId);
  const active = players.find((p) => p.seat === activeSeat);
  const myTurn = me?.seat === activeSeat;
  const load = useCallback(async () => {
    const { data: g } = await supabase
      .from("games")
      .select("id,state_version,status")
      .eq("room_id", room.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();
    if (!g) return;
    setGame(g as Game);
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase
        .from("rounds")
        .select(
          "id,number,cat_id,starter_seat,active_seat,phase,cycle,deadline,steals_taken",
        )
        .eq("game_id", g.id)
        .order("number", { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from("players")
        .select("id,user_id,nickname,seat,score,is_host")
        .eq("room_id", room.id)
        .is("left_at", null)
        .order("seat"),
    ]);
    setPlayers((p ?? []) as Player[]);
    if (!r) return;
    setRound(r as Round);
    const [{ data: c }, { data: h }, { data: pc }] = await Promise.all([
      supabase
        .from("cat_definitions")
        .select("id,name,points,preference_tokens")
        .eq("id", r.cat_id)
        .single(),
      supabase
        .from("hand_cards")
        .select("id,food,powerup,card_kind,player_id")
        .eq("round_id", r.id),
      supabase
        .from("plate_cards")
        .select("id,food,player_id,position")
        .eq("round_id", r.id)
        .order("position"),
    ]);
    setCat(c as Cat);
    setHand((h ?? []) as Card[]);
    setPlates((pc ?? []) as Card[]);
  }, [room.id, supabase]);
  useEffect(() => {
    const refresh = () => {
      setNow(Date.now());
      void load();
    };
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 2000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);
  const seconds = Math.max(
    0,
    Math.ceil((new Date(round?.deadline ?? 0).getTime() - now) / 1000),
  );
  useEffect(() => {
    if (activeSeat === undefined) return;
    const previous = previousActiveSeat.current;
    previousActiveSeat.current = activeSeat;
    if (previous === undefined || previous === activeSeat) return;
    setShakingSeat(activeSeat);
    const timer = window.setTimeout(() => setShakingSeat(undefined), 700);
    return () => window.clearTimeout(timer);
  }, [activeSeat]);
  useEffect(() => {
    if (seconds !== 0 || !game) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const token = await getAnonymousAccessToken();
        await fetch("/api/game", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            command: "advance",
            gameId: game.id,
            expectedVersion: game.state_version,
            idempotencyKey: crypto.randomUUID(),
          }),
        });
        await load();
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [seconds, game, load]);
  async function command(kind: "plate" | "pass" | "steal" | "finish_steal") {
    if (!game) return;
    setBusy(true);
    const token = await getAnonymousAccessToken();
    const response = await fetch("/api/game", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        command: "action",
        gameId: game.id,
        kind,
        cardIds: selected,
        targetCard: target ?? null,
        expectedVersion: game.state_version,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    setBusy(false);
    if (response.ok) {
      setSelected([]);
      setTarget(undefined);
      await load();
    }
  }
  async function playPowerup(card: Card) {
    if (!game) return;
    setBusy(true);
    await supabase.rpc("use_powerup", {
      game_id: game.id,
      powerup_card: card.id,
      target_players: targetPlayers,
      target_cards: powerTargets,
      expected_version: game.state_version,
      idempotency_key: crypto.randomUUID(),
    });
    setBusy(false);
    setPowerTargets([]);
    setTargetPlayers([]);
    await load();
  }
  async function saveOrder() {
    if (!game) return;
    setBusy(true);
    await supabase.rpc("reorder_plate", {
      game_id: game.id,
      card_ids: plateOrder,
      expected_version: game.state_version,
      idempotency_key: crypto.randomUUID(),
    });
    setBusy(false);
    setReordering(false);
    await load();
  }
  function beginReorder() {
    const ids = plates
      .filter((c) => c.player_id === me?.id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((c) => c.id);
    setPlateOrder(ids);
    setReordering(true);
  }
  function moveCard(id: string, delta: number) {
    setPlateOrder((current) => {
      const index = current.indexOf(id),
        next = index + delta;
      if (index < 0 || next < 0 || next >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  }
  function toggle(card: Card) {
    if (card.card_kind !== "food") return;
    setSelected((current) =>
      current.includes(card.id)
        ? current.filter((id) => id !== card.id)
        : round?.phase === "plating"
          ? current.length &&
            hand.find((c) => c.id === current[0])?.food !== card.food
            ? [card.id]
            : [...current, card.id]
          : [...current.slice(-1), card.id],
    );
  }
  const selectedCards = useMemo(
    () => hand.filter((c) => selected.includes(c.id)),
    [hand, selected],
  );
  if (!game || !round || !cat)
    return (
      <main className="game-page loading">
        <LoaderCircle className="animate-spin" />
        <p>Dealing the cards…</p>
      </main>
    );
  if (game.status === "finished")
    return (
      <main className="game-page">
        <section className="result-card">
          <p className="eyebrow">The feast is over</p>
          <h1 className="font-display text-5xl font-black">Final standings</h1>
          {[...players]
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .map((p) => (
              <div className="standing" key={p.id}>
                <strong>
                  #
                  {1 +
                    players.filter((q) => (q.score ?? 0) > (p.score ?? 0))
                      .length}{" "}
                  {p.nickname}
                </strong>
                <span>{p.score} pts</span>
              </div>
            ))}
          <Link className="primary-button mt-6" href="/">
            Leave room
          </Link>
        </section>
      </main>
    );
  return (
    <main className="game-page">
      <header className="game-header">
        <Link href="/" className="brand-mark">
          <span className="brand-paw">✦</span>Regular Kitties
        </Link>
        <div className="turn-chip">
          <Clock3 size={16} />
          <strong>{seconds}s</strong>
          <span>
            {active?.nickname}&apos;s {round.phase} turn
          </span>
        </div>
        <span className="room-mini">Room {code}</span>
      </header>
      <div className="game-shell">
        <section className="board-area">
          <div className="cat-card compact-cat">
            <Image
              src="/cat-placeholder.png"
              alt={cat.name}
              width={140}
              height={180}
            />
            <div>
              <p className="eyebrow">{cat.points} point cat</p>
              <h1 className="font-display text-3xl font-black">{cat.name}</h1>
              <div className="preference large-preference">
                {cat.preference_tokens.map((token, index) => (
                  <PreferenceTokenDisplay
                    key={`${token}-${index}`}
                    token={token}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="plates six-plates">
            {players.map((player) => {
              const playerCards = plates.filter(
                (card) => card.player_id === player.id,
              );
              const selectedPlayer = targetPlayers.includes(player.id);
              const playerColor = PLAYER_COLORS[player.seat - 1] ?? "#d85f43";
              return (
                <div
                  key={player.id}
                  className={`plate ${player.id === active?.id ? "active" : ""} ${selectedPlayer ? "selected-player" : ""}`}
                  style={{ "--player-color": playerColor } as CSSProperties}
                  onClick={() =>
                    setTargetPlayers((current) =>
                      current.includes(player.id)
                        ? current.filter((id) => id !== player.id)
                        : [...current.slice(-1), player.id],
                    )
                  }
                >
                  <strong>{player.nickname}&apos;s plate</strong>
                  <div>
                    {reordering && player.id === me?.id ? (
                      plateOrder.map((id, index) => {
                        const card = playerCards.find(
                          (item) => item.id === id,
                        )!;
                        return (
                          <div className="reorder-card" key={id}>
                            <FoodCard
                              card={card}
                              selected={false}
                              onClick={() => {}}
                            />
                            <button
                              disabled={index === 0}
                              onClick={(event) => {
                                event.stopPropagation();
                                moveCard(id, -1);
                              }}
                            >
                              ←
                            </button>
                            <button
                              disabled={index === plateOrder.length - 1}
                              onClick={(event) => {
                                event.stopPropagation();
                                moveCard(id, 1);
                              }}
                            >
                              →
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <PlateStacks
                        cards={playerCards}
                        selected={[target, ...powerTargets].filter(
                          (id): id is string => Boolean(id),
                        )}
                        onSelect={(card) => {
                          if (player.id !== me?.id) setTarget(card.id);
                          setPowerTargets((current) =>
                            current.includes(card.id)
                              ? current.filter((id) => id !== card.id)
                              : [...current.slice(-1), card.id],
                          );
                        }}
                      />
                    )}
                  </div>
                  {player.id === me?.id &&
                  myTurn &&
                  round.phase === "plating" ? (
                    <button
                      className="reorder-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (reordering) void saveOrder();
                        else beginReorder();
                      }}
                    >
                      {reordering ? "Save order" : "Reorder plate"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
        <aside className="game-rail">
          <RoomChat roomId={room.id} />
          <section className="player-status">
            {players.map((player) => {
              const playerColor = PLAYER_COLORS[player.seat - 1] ?? "#d85f43";
              return (
                <div
                  className={player.id === active?.id ? "active" : ""}
                  key={player.id}
                  style={{ borderColor: playerColor }}
                >
                  <span
                    className={`player-avatar ${player.seat === shakingSeat ? "turn-shake" : ""}`}
                    style={{ background: playerColor }}
                  >
                    {player.nickname[0]}
                  </span>
                  <strong>{player.nickname}</strong>
                  <small>
                    {player.score ?? 0} pts · Seat {player.seat}
                  </small>
                  {player.is_host ? <Crown size={13} /> : null}
                </div>
              );
            })}
          </section>
        </aside>
      </div>
      <section className="hand-dock reference-dock">
        <div className="hand-title">
          <span>
            <small>Your hand · {hand.length} cards</small>
            <strong>
              {selected.length ? `${selected.length} selected` : "Choose cards"}
            </strong>
          </span>
          <div className="hand-actions">
            <button
              disabled={!myTurn || busy}
              onClick={() =>
                void command(
                  round.phase === "plating" ? "pass" : "finish_steal",
                )
              }
            >
              {round.phase === "plating" ? "Pass" : "Finish stealing"}
            </button>
            {round.phase === "plating" ? (
              <button
                className="primary-button"
                disabled={!myTurn || !selected.length || busy}
                onClick={() => void command("plate")}
              >
                Plate selected
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={
                  !myTurn ||
                  selectedCards.length !== 2 ||
                  selectedCards[0]?.food !== selectedCards[1]?.food ||
                  !target ||
                  busy
                }
                onClick={() => void command("steal")}
              >
                Steal card
              </button>
            )}
          </div>
        </div>
        <div className="hand-cards">
          {hand.map((card) =>
            card.card_kind === "powerup" && card.powerup ? (
              <PowerupCard
                key={card.id}
                card={card}
                disabled={!myTurn || round.phase !== "stealing" || busy}
              onUse={() => void playPowerup(card)}
              />
            ) : (
              <FoodCard
                key={card.id}
                card={card}
                selected={selected.includes(card.id)}
                onClick={() => toggle(card)}
              />
            ),
          )}
        </div>
      </section>
    </main>
  );
}
function PreferenceTokenDisplay({ token }: { token: PreferenceToken }) {
  if (FOODS.includes(token as Food)) {
    const food = token as Food;
    return (
      <span className="token food-rule" aria-label={LABELS[food]}>
        <Image src={`/foods/${food}.png`} alt="" width={58} height={58} />
      </span>
    );
  }
  return <span className="operator">{token}</span>;
}
function FoodCard({
  card,
  selected,
  onClick,
}: {
  card: Card;
  selected: boolean;
  onClick: () => void;
}) {
  if (!card.food) return null;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`food-card ${selected ? "selected" : ""}`}
    >
      <Image src={`/foods/${card.food}.png`} alt="" width={84} height={84} />
      <span>{LABELS[card.food]}</span>
    </button>
  );
}
function PowerupCard({
  card,
  disabled,
  onUse,
}: {
  card: Card;
  disabled: boolean;
  onUse: () => void;
}) {
  const powerup = card.powerup ? POWERUPS[card.powerup] : null;
  if (!powerup) return null;
  return (
    <button
      className="food-card powerup-card"
      disabled={disabled}
      onClick={onUse}
      title={powerup.description}
      aria-label={`${powerup.name}: ${powerup.description}`}
    >
      <Image src={powerup.image} alt="" width={84} height={84} />
      <span>{powerup.name}</span>
      <small>{powerup.description}</small>
    </button>
  );
}
function PlateStacks({
  cards,
  selected,
  onSelect,
}: {
  cards: Card[];
  selected: string[];
  onSelect: (card: Card) => void;
}) {
  const groups: Card[][] = [];
  for (const card of cards) {
    const last = groups.at(-1);
    if (last?.[0].food === card.food) last.push(card);
    else groups.push([card]);
  }
  return groups.map((group) => {
    const food = group[0].food;
    if (!food) return null;
    return (
      <button
        key={group[0].id}
        className={`plate-stack ${group.some((card) => selected.includes(card.id)) ? "selected" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(group[0]);
        }}
        aria-label={`${group.length} ${food} cards`}
      >
        <Image src={`/foods/${food}.png`} alt="" width={62} height={62} />
        {group.length > 1 ? <b>{group.length}</b> : null}
      </button>
    );
  });
}
