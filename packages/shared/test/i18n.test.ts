import { afterEach, describe, expect, it } from "bun:test";
import {
  catalogs,
  formatDate,
  formatNumber,
  getLocale,
  resolveLocale,
  setLocale,
  subscribeLocale,
  t,
  validateCatalogs,
} from "../src/i18n";
import { createSettingsStore } from "../src/stores/settings";

afterEach(() => setLocale("en"));

describe("locale foundation", () => {
  it("resolves the device's first supported language, else English", () => {
    expect(resolveLocale(["fi-FI", "sv-FI", "en-US"])).toBe("sv");
    expect(resolveLocale(["sv-SE"])).toBe("sv");
    expect(resolveLocale(["en-GB", "sv-SE"])).toBe("en");
    expect(resolveLocale(["SV-fi"])).toBe("sv");
    expect(resolveLocale(["fi-FI"])).toBe("en");
    expect(resolveLocale([])).toBe("en");
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
      detectLanguageTags: () => ["sv-FI"],
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
      language: "sv",
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
    for (const language of ["sv", "en"] as const) {
      store.getState().setLanguage(language);
      expect(createSettingsStore({ storage }).getState().language).toBe(
        language,
      );
      expect(JSON.parse(storage.getItem()!).state.hydrated).toBeUndefined();
    }
  });

  it("waits for async persisted preferences and safely completes on storage failure", async () => {
    let complete!: (value: string) => void;
    let saved = "";
    const store = createSettingsStore({
      detectLanguageTags: () => ["sv-SE"],
      storage: {
        getItem: () =>
          new Promise<string>((resolve) => {
            complete = resolve;
          }),
        setItem: (_key: string, value: string) => {
          saved = value;
        },
        removeItem: () => {},
      },
    });
    expect(store.getState().hydrated).toBe(false);
    const done = new Promise<void>((resolve) =>
      store.persist.onFinishHydration(() => resolve()),
    );
    // A saved System from an older build, read asynchronously like SecureStore.
    complete(JSON.stringify({ version: 0, state: { language: "system" } }));
    await done;
    expect(store.getState()).toMatchObject({ hydrated: true, language: "sv" });
    expect(JSON.parse(saved).state.language).toBe("sv");
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
      language: "en",
    });
  });

  it("resolves a new install or a saved system to the device's language once, and saves it", () => {
    const swedish = () => ["sv-FI", "en-US"];
    const english = () => ["en-GB", "sv-SE"];
    const cases: [string | null, () => string[], string][] = [
      ["system", swedish, "sv"],
      ["system", english, "en"],
      ["sv", english, "sv"],
      ["en", swedish, "en"],
      ["fi", swedish, "sv"],
      [null, swedish, "sv"],
      [null, english, "en"],
    ];
    for (const [saved, device, expected] of cases) {
      const storage = memory(
        saved === null
          ? null
          : JSON.stringify({ version: 0, state: { language: saved, countHelp: true } }),
      );
      const store = createSettingsStore({ storage, detectLanguageTags: device });
      expect(store.getState().language).toBe(expected);
      // Saved as the concrete language, so it stays when the device's language changes.
      expect(JSON.parse(storage.getItem()!).state.language).toBe(expected);
      const other = device === swedish ? english : swedish;
      expect(
        createSettingsStore({ storage, detectLanguageTags: other }).getState().language,
      ).toBe(expected);
      if (saved !== null) expect(store.getState().countHelp).toBe(true);
    }
  });

  it("takes English when the device cannot say", () => {
    const store = createSettingsStore({
      storage: memory(),
      detectLanguageTags: () => {
        throw new Error("unavailable");
      },
    });
    expect(store.getState().language).toBe("en");
  });
});
