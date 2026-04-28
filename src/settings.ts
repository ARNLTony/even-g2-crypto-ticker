import {
  CATALOG,
  FIAT_QUOTES,
  MAX_COINS,
  QUOTE_LABEL,
  QUOTE_NAME,
  STABLECOIN_QUOTES,
  type Coin,
  type Quote,
} from "./catalog";

const ALL_QUOTES = new Set<Quote>([...STABLECOIN_QUOTES, ...FIAT_QUOTES]);

export type SettingsState = {
  watchlist: string[];
  quote: Quote;
};

export type SettingsCallbacks = {
  onChange: (state: SettingsState) => void;
};

export function mountSettings(
  root: HTMLElement,
  initial: SettingsState,
  cb: SettingsCallbacks
): void {
  let state: SettingsState = {
    watchlist: [...initial.watchlist],
    quote: initial.quote,
  };
  const lookup = new Map(CATALOG.map((c) => [c.symbol, c]));

  function commit(next: Partial<SettingsState>) {
    state = { ...state, ...next };
    cb.onChange(state);
    render();
  }

  function setQuote(q: Quote) {
    if (state.quote === q) return;
    commit({ quote: q });
  }

  function move(symbol: string, delta: number) {
    const i = state.watchlist.indexOf(symbol);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.watchlist.length) return;
    const next = [...state.watchlist];
    [next[i], next[j]] = [next[j], next[i]];
    commit({ watchlist: next });
  }

  function add(symbol: string) {
    if (state.watchlist.length >= MAX_COINS) return;
    if (state.watchlist.includes(symbol)) return;
    commit({ watchlist: [...state.watchlist, symbol] });
  }

  function remove(symbol: string) {
    commit({ watchlist: state.watchlist.filter((s) => s !== symbol) });
  }

  function render() {
    const selectedCoins = state.watchlist
      .map((s) => lookup.get(s))
      .filter((c): c is Coin => Boolean(c));
    const selectedSet = new Set(state.watchlist);
    const available = CATALOG.filter((c) => !selectedSet.has(c.symbol));
    const atLimit = state.watchlist.length >= MAX_COINS;

    root.innerHTML = `
      <header>
        <h1>Crypto Ticker</h1>
        <p>Choose up to ${MAX_COINS} coins to display on your glasses.</p>
        <p class="counter"><strong>${state.watchlist.length}</strong> / ${MAX_COINS} selected</p>
      </header>

      <section>
        <h2>Currency</h2>
        <select class="currency-select" data-action="set-quote">
          <optgroup label="Fiat">
            ${FIAT_QUOTES.map(
              (q) => `
              <option value="${q}" ${state.quote === q ? "selected" : ""}>
                ${QUOTE_LABEL[q]} — ${QUOTE_NAME[q]}
              </option>`
            ).join("")}
          </optgroup>
          <optgroup label="Stablecoins (USD-pegged)">
            ${STABLECOIN_QUOTES.map(
              (q) => `
              <option value="${q}" ${state.quote === q ? "selected" : ""}>
                ${QUOTE_LABEL[q]} — ${QUOTE_NAME[q]}
              </option>`
            ).join("")}
          </optgroup>
        </select>
      </section>

      <section>
        <h2>On glasses</h2>
        <ul class="list">
          ${
            selectedCoins.length === 0
              ? `<li class="empty">No coins selected — pick from below.</li>`
              : selectedCoins
                  .map(
                    (c, i) => `
            <li data-symbol="${c.symbol}">
              <span class="row-num">${i + 1}</span>
              <span class="row-symbol">${c.symbol}</span>
              <span class="row-name">${c.name}</span>
              <button data-action="up" aria-label="Move up" ${
                i === 0 ? "disabled" : ""
              }>↑</button>
              <button data-action="down" aria-label="Move down" ${
                i === selectedCoins.length - 1 ? "disabled" : ""
              }>↓</button>
              <button class="danger" data-action="remove" aria-label="Remove">×</button>
            </li>`
                  )
                  .join("")
          }
        </ul>
      </section>

      <section>
        <h2>All coins ${
          atLimit ? "<span class='hint'>(slots full)</span>" : ""
        }</h2>
        <ul class="list">
          ${available
            .map(
              (c) => `
            <li data-symbol="${c.symbol}">
              <span class="row-symbol">${c.symbol}</span>
              <span class="row-name">${c.name}</span>
              <button class="accent" data-action="add" aria-label="Add" ${
                atLimit ? "disabled" : ""
              }>+</button>
            </li>`
            )
            .join("")}
        </ul>
      </section>

      <footer class="app-footer">Data from Binance</footer>
    `;

    const select = root.querySelector<HTMLSelectElement>(
      "select.currency-select"
    );
    select?.addEventListener("change", () => {
      const q = select.value as Quote;
      if (ALL_QUOTES.has(q)) setQuote(q);
    });

    root.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach(
      (btn) => {
        btn.addEventListener("click", () => {
          const action = btn.dataset.action;
          const li = btn.closest<HTMLLIElement>("li[data-symbol]");
          const symbol = li?.dataset.symbol;
          if (!symbol) return;
          if (action === "add") add(symbol);
          else if (action === "remove") remove(symbol);
          else if (action === "up") move(symbol, -1);
          else if (action === "down") move(symbol, 1);
        });
      }
    );
  }

  render();
}
