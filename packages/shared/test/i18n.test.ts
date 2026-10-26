import { afterEach, describe, expect, it } from "bun:test";
import {
  catalogs,
  formatDate,
  formatNumber,
  getLocale,
  resolveLocale,
  setLocale,
  subscribeLocale,
  syncLocale,
  t,
  validateCatalogs,
} from "../src/i18n";
import { createSettingsStore } from "../src/stores/settings";

afterEach(() => setLocale("en"));

describe("locale foundation", () => {
  it("uses ordered supported device languages and explicit preferences", () => {
    expect(resolveLocale("system", ["fi-FI", "sv-FI", "en-US"])).toBe("sv");
    expect(resolveLocale("system", ["sv-SE"])).toBe("sv");
    expect(resolveLocale("system", ["en-GB", "sv-SE"])).toBe("en");
    expect(resolveLocale("system", ["SV-fi"])).toBe("sv");
    expect(resolveLocale("system", ["fi-FI"])).toBe("en");
    expect(resolveLocale("system", [])).toBe("en");
    expect(resolveLocale("en", ["sv-SE"])).toBe("en");
    expect(resolveLocale("sv", ["en-US"])).toBe("sv");
  });

  it("updates existing subscribers and imperative translations without remount", () => {
    const seen: string[] = [];
    const stop = subscribeLocale(() => seen.push(t("common.cancel")));
    setLocale("sv");
    expect(getLocale()).toBe("sv");
    expect(t("invite.code", { code: "7KQ4-M2XB" })).toBe("Inbjudan 7KQ4-M2XB");
    setLocale("sv");
    setLocale("en");
    expect(seen).toEqual(["Avbryt", "Cancel"]);
    stop();
    setLocale("sv");
    expect(seen).toHaveLength(2);
  });

  it("refreshes system resolution while explicit choice wins and detection failures fall back", () => {
    let tags = ["sv-FI"];
    const detector = () => tags;
    expect(syncLocale("system", detector)).toBe("sv");
    tags = ["en-US"];
    expect(syncLocale("system", detector)).toBe("en");
    expect(
      syncLocale("sv", () => {
        throw new Error("must not detect");
      }),
    ).toBe("sv");
    expect(
      syncLocale("system", () => {
        throw new Error("unavailable");
      }),
    ).toBe("en");
  });

  it("formats numbers and dates in the current locale", () => {
    const date = new Date("2026-01-02T12:00:00Z");
    const options: Intl.DateTimeFormatOptions = {
      month: "long",
      timeZone: "UTC",
    };
    expect(formatNumber(1234.5)).toBe("1,234.5");
    expect(formatDate(date, options)).toBe("January");
    setLocale("sv");
    expect(formatNumber(1234.5)).toBe("1\u00a0234,5");
    expect(formatDate(date, options)).toBe("januari");
    expect(formatNumber(0.5, { style: "percent" })).toBe("50\u00a0%");
  });

  it("keeps every catalog key, plural branch and placeholder in parity", () => {
    expect(validateCatalogs(catalogs.en, catalogs.sv)).toEqual([]);
    expect(Object.keys(catalogs.en).length).toBeGreaterThanOrEqual(110);
    expect(
      validateCatalogs({ x: "Hi %{name}" }, { x: "Hej %{other}" }),
    ).not.toEqual([]);
    expect(validateCatalogs({ x: "Hi" }, {})).not.toEqual([]);
    expect(
      validateCatalogs(
        { x: { one: "%{count} player", other: "%{count} players" } },
        { x: { one: "%{count} spelare", other: "%{count} spelare" } },
      ),
    ).toEqual([]);
    expect(
      validateCatalogs(
        { x: { one: "%{count} player", other: "%{count} players" } },
        { x: { one: "en spelare", other: "%{count} spelare", zero: "Ingen" } },
      ),
    ).not.toEqual([]);
  });

  it("keeps internal Classic and claim terminology out of player-facing copy", () => {
    const jargon: string[] = [];
    for (const [locale, catalog] of Object.entries(catalogs)) {
      for (const [key, entry] of Object.entries(catalog)) {
        const branches = typeof entry === "string" ? { text: entry } : entry;
        for (const [branch, text] of Object.entries(branches)) {
          if (/classic|claim/i.test(text)) jargon.push(`${locale}:${key}:${branch}: ${text}`);
        }
      }
    }
    expect(jargon).toEqual([]);
  });
});

describe("settings language migration and hydration", () => {
  const memory = (initial: string | null = null) => {
    let value = initial;
    return {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
      removeItem: () => {
        value = null;
      },
    };
  };

  it("migrates existing version-0 settings with no language without losing choices", () => {
    const store = createSettingsStore({
      storage: memory(
        JSON.stringify({
          version: 0,
          state: {
            theme: "dark",
            soundEnabled: false,
            pins: { player: "none" },
            preferredRuleSet: "louisiana",
          },
        }),
      ),
    });
    expect(store.getState()).toMatchObject({
      hydrated: true,
      language: "system",
      theme: "dark",
      soundEnabled: false,
      pins: { player: "none" },
      preferredRuleSet: "louisiana",
      showBid: true,
    });
  });

  it("migrates the old pace and persists both new choices without losing other settings", () => {
    for (const [saved, expected] of [
      ["slow", "own"],
      ["normal", "quick"],
      ["own", "own"],
      ["quick", "quick"],
      [undefined, "quick"],
    ]) {
      const storage = memory(
        JSON.stringify({
          version: 0,
          state: { pace: saved, language: "sv", countHelp: true },
        }),
      );
      const store = createSettingsStore({ storage });
      expect(store.getState()).toMatchObject({
        pace: expected,
        language: "sv",
        countHelp: true,
      });
      for (const pace of ["quick", "own"] as const) {
        store.getState().setPace(pace);
        expect(createSettingsStore({ storage }).getState().pace).toBe(pace);
      }
    }
  });

  it("persists language choices and never persists hydration state", () => {
    const storage = memory();
    const store = createSettingsStore({ storage });
    for (const language of ["sv", "en", "system"] as const) {
      store.getState().setLanguage(language);
      expect(createSettingsStore({ storage }).getState().language).toBe(
        language,
      );
      expect(JSON.parse(storage.getItem()!).state.hydrated).toBeUndefined();
    }
  });

  it("waits for async persisted preferences and safely completes on storage failure", async () => {
    let complete!: (value: string) => void;
    const store = createSettingsStore({
      storage: {
        getItem: () =>
          new Promise<string>((resolve) => {
            complete = resolve;
          }),
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(store.getState().hydrated).toBe(false);
    const done = new Promise<void>((resolve) =>
      store.persist.onFinishHydration(() => resolve()),
    );
    complete(JSON.stringify({ version: 0, state: { language: "sv" } }));
    await done;
    expect(store.getState()).toMatchObject({ hydrated: true, language: "sv" });
    const failed = createSettingsStore({
      storage: {
        getItem: () => {
          throw new Error("storage unavailable");
        },
        setItem: () => {},
        removeItem: () => {},
      },
    });
    await Promise.resolve();
    expect(failed.getState()).toMatchObject({
      hydrated: true,
      language: "system",
    });
  });

  it("normalizes unsupported saved language values to system", () => {
    const store = createSettingsStore({
      storage: memory(
        JSON.stringify({
          version: 0,
          state: { language: "fi", hydrated: true },
        }),
      ),
    });
    expect(store.getState().language).toBe("system");
  });
});
