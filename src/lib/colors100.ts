// The colour library of "I am": 100 named colours. Each one knows when it
// belongs in the sky:
//   phases  N Nacht · B Blaue Stunde · D Morgenrot/Sonnenaufgang · M Morgen
//           T Tag · A Nachmittag/goldene Stunde · S Sonnenuntergang
//   weather c klar · w bewölkt · r Regen · s Schnee · f Nebel · g Gewitter
//           (empty = fits any weather)
//   seasons wi Winter · fr Frühling · so Sommer · he Herbst (empty = any)
//   alp     belongs to the mountains (chosen more above ~900 m)
// The engine scores every colour for "now, here" and picks the best ~10.

export interface LibColor {
  hex: string;
  name: string;
  phases: string;
  weather: string;
  seasons: string;
  alp?: boolean;
}

const c = (hex: string, name: string, phases: string, weather = "", seasons = "", alp = false): LibColor => ({
  hex,
  name,
  phases,
  weather,
  seasons,
  alp,
});

export const COLORS: LibColor[] = [
  // ---- Nacht
  c("#0b1a3a", "Mitternachtsblau", "N"),
  c("#1a1446", "Tiefes Indigo", "B"),
  c("#2b1b5e", "Nachtviolett", "B"),
  c("#3a2a78", "Pflaumenblau", "B"),
  c("#14324a", "Nachtpetrol", "N"),
  c("#0f4c5c", "Tiefsee", "N", "r"),
  c("#1d5b6e", "Nachtsee", "N"),
  c("#4b3f8f", "Lavendelnacht", "B"),
  c("#1c4f7a", "Fjordblau", "N"),
  c("#8fa3c7", "Mondlicht", "N", "cs"),
  c("#c9d3e6", "Mondsilber", "N", "cs"),
  c("#2e6b8a", "Polarblau", "N", "cs", "wi"),
  c("#3fb59a", "Polarlichtgrün", "N", "c", "wi"),
  c("#2fa37f", "Nordlicht", "N", "c"),
  c("#0f5a4a", "Smaragdnacht", "N"),
  c("#1f3b2f", "Nachtwald", "N"),
  c("#2d4a2f", "Moosdunkel", "N", "", "hewi"),
  c("#1f4a3a", "Tannengrün", "N"),
  c("#9ab8ff", "Sternblau", "N", "c"),
  // ---- Blaue Stunde & Dämmerung
  c("#3c4fb0", "Blaue Stunde", "BD"),
  c("#5a6fd6", "Dämmerblau", "BD"),
  c("#8a7fe0", "Dämmerlila", "BD"),
  c("#b48ad8", "Fliederdämmerung", "BD"),
  c("#e08fb8", "Rosa Dämmerung", "BDS"),
  c("#f2a7a0", "Lachsdämmerung", "DS"),
  c("#6f87c7", "Taubenblau", "BD", "wf"),
  c("#93a6c9", "Nebelblau", "DM", "fw"),
  c("#c0a6d8", "Malve", "DB"),
  // ---- Sonnenaufgang
  c("#ffb38a", "Morgenrot", "D"),
  c("#ff9a8b", "Korallenmorgen", "D"),
  c("#ffcf9e", "Aprikosenlicht", "DM"),
  c("#ffe0b2", "Morgengold", "DM"),
  c("#f7c6d9", "Kirschblüte", "DM", "", "fr"),
  c("#fbd3e9", "Rosenquarz", "DM"),
  c("#c8b6f0", "Lavendelmorgen", "DM"),
  c("#a8c8f0", "Frühblau", "DM"),
  // ---- Morgen
  c("#cfe7f7", "Morgenhimmel", "MT", "c"),
  c("#e6f2fa", "Klarluft", "MT", "c"),
  c("#f9eedc", "Leinen", "MT"),
  c("#ffe9c7", "Butterlicht", "MT", "", "so"),
  c("#d9f0e4", "Minzhauch", "MT", "", "fr"),
  c("#bfe6d4", "Salbei", "MT", "", "frso"),
  c("#a8d8c8", "Jadehauch", "M", "", "fr"),
  c("#fff4d6", "Vanille", "MT"),
  c("#ffefe0", "Morgenmilch", "M"),
  // ---- Tag
  c("#8ccaf2", "Himmelblau", "T", "c", "so"),
  c("#6fb6ea", "Sommerhimmel", "T", "c", "so"),
  c("#b3dbf5", "Pastellhimmel", "T"),
  c("#4fa3c8", "Bergseeblau", "T", "", "so", true),
  c("#7fd1c7", "Gletscherwasser", "T", "", "", true),
  c("#bfe9ef", "Gletschereis", "T", "s", "wi", true),
  c("#b8e0f0", "Eisblau", "T", "", "wi"),
  c("#e9f1f7", "Schneeweiss", "T", "s", "wi"),
  c("#d0d8e2", "Wolkengrau", "T", "wfr"),
  c("#b9c3d0", "Regengrau", "T", "rw"),
  c("#9fb3c4", "Schieferblau", "T", "r"),
  c("#a6d6a0", "Wiesengrün", "T", "", "frso"),
  c("#c7e3a0", "Frühlingsgrün", "T", "", "fr"),
  c("#2f8f8a", "Lagune", "T", "c", "so"),
  c("#ffd86b", "Sonnengelb", "T", "c", "so"),
  c("#ffe58f", "Zitronenlicht", "T", "c", "frso"),
  c("#f5c26b", "Kornfeld", "T", "", "sohe"),
  c("#e8a25a", "Herbstgold", "TA", "", "he"),
  c("#e9d7c2", "Sand", "T", "", "so"),
  c("#f2e6d0", "Muschel", "T"),
  // ---- Nachmittag & goldene Stunde
  c("#d9823b", "Kürbis", "A", "", "he"),
  c("#c46a3c", "Rost", "AS", "", "he"),
  c("#ffc79a", "Pfirsichlicht", "A"),
  c("#ffb070", "Goldene Stunde", "A", "c"),
  c("#ffcf6a", "Honig", "A", "c", "so"),
  c("#ff9f6e", "Mandarine", "AS"),
  c("#f7a1a8", "Rosenlicht", "AS"),
  c("#f3b6c8", "Pfingstrose", "A", "", "frso"),
  c("#d8a6e8", "Orchidee", "AS"),
  c("#ffdcb0", "Champagner", "AT"),
  // ---- Sonnenuntergang
  c("#ff6a3d", "Glut", "S", "c"),
  c("#ff5c5c", "Abendrot", "S", "c"),
  c("#ff4f7b", "Himbeerhimmel", "S"),
  c("#e0457a", "Magenta", "S"),
  c("#c04aa0", "Fuchsie", "SB"),
  c("#9a4fd0", "Abendviolett", "SB"),
  c("#6a3fb5", "Amethyst", "SB"),
  c("#ff8a5b", "Feuerorange", "S"),
  c("#ffb347", "Bernstein", "SA"),
  c("#ffd27f", "Goldsaum", "SA"),
  c("#f26b8a", "Flamingo", "S"),
  c("#a8452f", "Ziegel", "S", "", "he"),
  c("#8a3a7a", "Beerenabend", "S", "", "he"),
  // ---- Wetter
  c("#7d8fa8", "Regenblau", "", "r"),
  c("#5f7389", "Sturmblau", "", "gr"),
  c("#4a4e6e", "Gewittergrau", "", "g"),
  c("#6b5b8c", "Gewitterlila", "", "g"),
  c("#a3b5a6", "Moosnebel", "", "f"),
  c("#c9c9d1", "Nebelweiss", "", "f"),
  c("#dcd4e8", "Nebellila", "", "f"),
  c("#b0c4de", "Schneelicht", "", "s"),
  c("#e3ecf7", "Pulverschnee", "", "s", "wi"),
  c("#9db4cc", "Frostblau", "", "s", "wi"),
  c("#f0c9a8", "Föhnpfirsich", "AT", "c", "", true),
  c("#e9b8c8", "Föhnrosa", "AS", "c", "", true),
];
