import type { TranslationEntry } from "../catalogs";

export const en = {
  "league.title": "%{league}",
  "league.room": "%{size} players from %{league}.",
  "league.promote": "The top %{count} move up to %{league} on Sunday night.",
  "league.promote_one": "The top player moves up to %{league} on Sunday night.",
  "league.move_up": "Move up to %{league}",
  "league.demote": "Places %{from} to %{to} move down to %{league}.",
  "league.demote_one": "Place %{from} moves down to %{league}.",
  "league.not_placed": "Play a game with people to join this week’s room",
  "league.opted_out": "You’re hidden from leagues. Your Level keeps growing.",
  "league.join_again": "Join leagues again",
  "league.guest": "Register to join this week’s league",
  "league.register": "Create an account",
  "league.off": "Weekly leagues are coming soon",
  "league.last_week": "Last week: %{place} in %{league}",
  "league.you": "you",
  "league.loading": "Loading your league…",
  "league.failed": "Couldn’t load your league. Try again.",
  "league.retry": "Try again",
  "league.intro_title": "Weekly leagues",
  "league.intro_ladder": "Deuce, Ten, Jack, Ace, then the Pidro.",
  "league.intro_play": "Play with people",
  "league.intro_play_body":
    "Any online game with at least one other person counts, win or lose.",
  "league.intro_race": "Race your room",
  "league.intro_race_body":
    "A room of players from your league. Everyone starts the week at 0.",
  "league.intro_move": "Move up on Sunday",
  "league.intro_move_body":
    "The top players move up a league. Your best league of the month becomes its ribbon.",
  "league.intro_classic":
    "Everyone starts in Deuce this time. Your Level stays.",
  "league.got_it": "Got it",
  "league.ribbon_so_far": "Ribbon so far: %{league}",
  "league.name.deuce": "Deuce league",
  "league.name.ten": "Ten league",
  "league.name.jack": "Jack league",
  "league.name.ace": "Ace league",
  "league.name.pidro": "Pidro league",
  "league.mark.deuce": "Deuce",
  "league.mark.ten": "Ten",
  "league.mark.jack": "Jack",
  "league.mark.ace": "Ace",
  "league.mark.pidro": "Pidro",
  "league.line.placed": "%{place} in %{league}",
  "league.line.not_placed": "%{league} · play a game to join",
  "league.close.line": "Ends %{day} at %{time} · %{duration}",
  "league.close.today": "today",
  "league.close.days": {
    one: "%{count} day left",
    other: "%{count} days left",
  },
  "league.close.hours": {
    one: "%{count} hour left",
    other: "%{count} hours left",
  },
  "league.close.minutes": {
    one: "%{count} minute left",
    other: "%{count} minutes left",
  },
  "league.close.closed": "week ended",
  "league.footer.no_demote": "Nobody moves down from Deuce.",
  "league.footer.no_bands":
    "This room has no promotion or demotion places this week.",
  "league.rules.title": "How leagues work",
  "league.rules.week":
    "The week ends at %{close}. The next one starts that second, everyone at 0.",
  "league.rules.room":
    "Your first counting game of the week puts you in a room with players from the same league. Rooms can have up to 40 players.",
  "league.rules.points":
    "Every game with people counts: the XP you earn there is your points. Alone with bots is practice.",
  "league.rules.bands":
    "The marked places in your room move up or down when the week ends. The bands depend on your league and room size.",
  "league.rules.skip": "Skip a week and you keep your league.",
  "league.rules.pidro": "Pidro is the top league: the 5 of trumps.",
  "league.result.week": "Week of %{date}",
  "league.result.up": "Up to %{league}",
  "league.result.stayed": "Still in %{league}",
  "league.result.down": "Down to %{league}",
  "league.result.summary":
    "You finished %{place} of %{size} in %{league}, with %{points} XP.",
  "league.result.ribbon_changed": "Your %{month} ribbon is now %{league}",
  "league.result.ribbon_unchanged": "Your %{month} ribbon: %{league}",
  "league.result.star_next": "Play next week too and it gets a star.",
  "league.result.star_possible": "Play every week and it gets a star.",
  "league.result.star_earned":
    "You played every week of the month. Your ribbon has a star.",
  "league.result.continue": "Meet your new room",
  "league.result.close": "Close",
  "league.ribbons.title": "Monthly ribbons",
  "league.ribbons.player": "%{name}’s ribbons",
  "league.ribbons.so_far": "%{month} so far",
  "league.ribbons.weeks": "Weeks played: %{played} of %{total}",
  "league.ribbons.best":
    "Your best league this month becomes the month’s ribbon.",
  "league.ribbons.star": "Play in every week of the month and it gets a star.",
  "league.ribbons.history": "Your last 12 ribbons sit on your profile.",
  "league.ribbons.no_race":
    "No monthly leaderboard. A new month collects your weeks.",
  "league.ribbons.empty": "Play a week to start your ribbon collection.",
  "league.ribbons.label": "%{month}, %{league}",
  "league.ribbons.label_star": "%{month}, %{league}, played every week",
  "league.friends.title": "Your friends this week",
  "league.friends.empty":
    "None of your friends have joined a league room this week yet.",
  "league.settings.title": "Leagues",
  "league.settings.hidden": "Hide me from leagues",
  "league.settings.help":
    "You won’t appear in a league room or your friends’ league lists. Your Level keeps growing.",
  "league.settings.midweek":
    "You’ll leave this week’s room. If you’ve played this week, your place now counts as your result.",
  "league.settings.error": "Couldn’t change your league setting. Try again.",
} as const satisfies Record<string, TranslationEntry>;

export const sv = {
  "league.title": "%{league}",
  "league.room": "%{size} spelare från %{league}.",
  "league.promote":
    "De %{count} bästa flyttar upp till %{league} på söndag kväll.",
  "league.promote_one":
    "Den bästa spelaren flyttar upp till %{league} på söndag kväll.",
  "league.move_up": "Flytta upp till %{league}",
  "league.demote": "Platserna %{from} till %{to} flyttar ner till %{league}.",
  "league.demote_one": "Plats %{from} flyttar ner till %{league}.",
  "league.not_placed":
    "Spela ett parti med andra för att gå med i veckans grupp",
  "league.opted_out": "Du är dold i ligorna. Din nivå fortsätter att växa.",
  "league.join_again": "Gå med i ligorna igen",
  "league.guest": "Registrera dig för att gå med i veckans liga",
  "league.register": "Skapa ett konto",
  "league.off": "Veckoligorna kommer snart",
  "league.last_week": "Förra veckan: %{place} i %{league}",
  "league.you": "du",
  "league.loading": "Laddar din liga…",
  "league.failed": "Det gick inte att ladda din liga. Försök igen.",
  "league.retry": "Försök igen",
  "league.intro_title": "Veckoligor",
  "league.intro_ladder": "Tvåan, tian, knekten, esset och till sist pidron.",
  "league.intro_play": "Spela med andra",
  "league.intro_play_body":
    "Alla onlinepartier med minst en annan person räknas, oavsett om du vinner eller förlorar.",
  "league.intro_race": "Tävla i din grupp",
  "league.intro_race_body":
    "En grupp med spelare från din liga. Alla börjar veckan på 0.",
  "league.intro_move": "Flytta upp på söndag",
  "league.intro_move_body":
    "De bästa spelarna flyttar upp en liga. Din bästa liga under månaden blir månadens band.",
  "league.intro_classic":
    "Alla börjar i Tvåans liga den här gången. Din nivå finns kvar.",
  "league.got_it": "Jag förstår",
  "league.ribbon_so_far": "Band hittills: %{league}",
  "league.name.deuce": "Tvåans liga",
  "league.name.ten": "Tians liga",
  "league.name.jack": "Knektens liga",
  "league.name.ace": "Essets liga",
  "league.name.pidro": "Pidroligan",
  "league.mark.deuce": "Tvåan",
  "league.mark.ten": "Tian",
  "league.mark.jack": "Knekten",
  "league.mark.ace": "Esset",
  "league.mark.pidro": "Pidro",
  "league.line.placed": "%{place} i %{league}",
  "league.line.not_placed": "%{league} · spela ett parti för att gå med",
  "league.close.line": "Slutar %{day} kl. %{time} · %{duration}",
  "league.close.today": "i dag",
  "league.close.days": {
    one: "%{count} dag kvar",
    other: "%{count} dagar kvar",
  },
  "league.close.hours": {
    one: "%{count} timme kvar",
    other: "%{count} timmar kvar",
  },
  "league.close.minutes": {
    one: "%{count} minut kvar",
    other: "%{count} minuter kvar",
  },
  "league.close.closed": "veckan är slut",
  "league.footer.no_demote": "Ingen flyttar ner från Tvåans liga.",
  "league.footer.no_bands":
    "Den här gruppen har inga upp- eller nedflyttningsplatser den här veckan.",
  "league.rules.title": "Så fungerar ligorna",
  "league.rules.week":
    "Veckan slutar %{close}. Nästa börjar samma sekund, alla på 0.",
  "league.rules.room":
    "Ditt första räknade parti i veckan placerar dig i en grupp med spelare från samma liga. En grupp kan ha upp till 40 spelare.",
  "league.rules.points":
    "Alla partier med andra räknas: den XP du tjänar där blir dina poäng. Ensam med botar är övning.",
  "league.rules.bands":
    "De markerade platserna i din grupp flyttar upp eller ner när veckan är slut. Gränserna beror på din liga och gruppens storlek.",
  "league.rules.skip": "Hoppa över en vecka så behåller du din liga.",
  "league.rules.pidro": "Pidro är den högsta ligan: trumffemman.",
  "league.result.week": "Veckan som började %{date}",
  "league.result.up": "Upp till %{league}",
  "league.result.stayed": "Kvar i %{league}",
  "league.result.down": "Ner till %{league}",
  "league.result.summary":
    "Du blev %{place} av %{size} i %{league}, med %{points} XP.",
  "league.result.ribbon_changed": "Ditt band för %{month} är nu %{league}",
  "league.result.ribbon_unchanged": "Ditt band för %{month}: %{league}",
  "league.result.star_next":
    "Spela nästa vecka också så får bandet en stjärna.",
  "league.result.star_possible": "Spela varje vecka så får bandet en stjärna.",
  "league.result.star_earned":
    "Du spelade varje vecka i månaden. Ditt band har en stjärna.",
  "league.result.continue": "Träffa din nya grupp",
  "league.result.close": "Stäng",
  "league.ribbons.title": "Månadsband",
  "league.ribbons.player": "%{name}s band",
  "league.ribbons.so_far": "%{month} hittills",
  "league.ribbons.weeks": "Spelade veckor: %{played} av %{total}",
  "league.ribbons.best": "Din bästa liga under månaden blir månadens band.",
  "league.ribbons.star":
    "Spela varje vecka i månaden så får bandet en stjärna.",
  "league.ribbons.history": "Dina senaste 12 band finns på din profil.",
  "league.ribbons.no_race":
    "Ingen månatlig topplista. En ny månad samlar dina veckor.",
  "league.ribbons.empty": "Spela en vecka för att börja samla band.",
  "league.ribbons.label": "%{month}, %{league}",
  "league.ribbons.label_star": "%{month}, %{league}, spelade varje vecka",
  "league.friends.title": "Dina vänner den här veckan",
  "league.friends.empty":
    "Ingen av dina vänner har gått med i en ligagrupp den här veckan än.",
  "league.settings.title": "Ligor",
  "league.settings.hidden": "Dölj mig i ligorna",
  "league.settings.help":
    "Du syns inte i någon ligagrupp eller i dina vänners ligalistor. Din nivå fortsätter att växa.",
  "league.settings.midweek":
    "Du lämnar veckans grupp. Om du har spelat den här veckan räknas din nuvarande plats som ditt resultat.",
  "league.settings.error":
    "Det gick inte att ändra din ligainställning. Försök igen.",
} as const satisfies Record<keyof typeof en, TranslationEntry>;
