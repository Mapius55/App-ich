# Farben – Recherche & nächster Schritt (pausiert)

Stand: Recherche abgeschlossen, Umsetzung pausiert. Ziel: Farben nicht mehr einzeln wählen,
sondern **erprobte Kombinationen** nehmen und nach Situation auslösen.

## Quelle für Kombinationen
- **Sanzo Wada, „A Dictionary of Color Combinations“** (348 Kombinationen aus 2–4 Farben, 159 Farben).
  Digitalisierter Datensatz: [mattdesl/dictionary-of-colour-combinations](https://github.com/mattdesl/dictionary-of-colour-combinations) (MIT-Lizenz, `colors.json`).
  Analyse-Skript: `scripts/colors/wada_analyse.py` (berechnet Helligkeit, Sättigung, Farbton je Kombination in OKLCh).

## Was die Forschung sagt
- **Helligkeit → angenehm, Sättigung → aktivierend.** Valdez & Mehrabian (1994): Helligkeit hat den stärksten Einfluss auf „Wohlgefühl“, Sättigung auf „Erregung“. ([Semantic Scholar](https://www.semanticscholar.org/paper/Effects-of-color-on-emotions.-Valdez-Mehrabian/d15bdf485f3a64abb59e4d0d1d1b18a9fc652bf9), [Wilms & Oberfeld 2018](https://www.staff.uni-mainz.de/oberfeld/downloads/Wilms-Oberfeld2018_Article_ColorAndEmotionEffectsOfHueSat.pdf): Farbton, Sättigung und Helligkeit wirken zusammen.)
- **Blau/Grün eher ruhig und positiv, Rot/Orange/Gelb eher anregend.** Systematische Übersicht über 128 Jahre Forschung ([Jonauskaite et al. 2024](https://link.springer.com/article/10.3758/s13423-024-02615-z)). Gedämpfte, kühle Töne beruhigen am stärksten; blasse Farben entspannen mehr als kräftige.
- **Harmonie:** Ähnliche Farbtöne wirken harmonisch; Menschen *bevorzugen* zusätzlich Helligkeitskontrast; hellere Paare und ähnliche Sättigung wirken harmonischer ([Schloss & Palmer 2011](https://palmerlab.berkeley.edu/pdf/Schloss&Palmer(2011).pdf)). Helle Figur auf dunklerem, bläulichem Grund wird bevorzugt ([Schloss & Palmer, Perception 2011](https://doi.org/10.1068/p6992)). Zweifarben-Modell: Harmonie steigt mit Helligkeitsunterschied und Helligkeit ([Ou & Luo 2006](https://onlinelibrary.wiley.com/doi/abs/10.1002/col.20208)).
- **Warum wir Farben mögen:** Ecological Valence Theory – Vorlieben folgen den Dingen, die wir mit Farben verbinden (klarer Himmel, sauberes Wasser = beliebt) ([Palmer & Schloss](https://sites.socsci.uci.edu/~kjameson/ECST/Palmer_Schloss_ColorPreference.pdf)). Vorlieben ändern sich mit der Jahreszeit.
- **Himmel in der Natur:** Goldene Stunde ≈ Sonne 0–6° über dem Horizont, blaue Stunde ≈ 4–8° darunter ([Wikipedia: Blue hour](https://en.wikipedia.org/wiki/Blue_hour)); Dämmerungsblau stammt grossteils von Ozon-Absorption ([Chappuis absorption](https://en.wikipedia.org/wiki/Chappuis_absorption)); bei Sonnenuntergang verläuft der Himmel vom Horizont Orange → Gelb → (Grün) → Blau ([Gedzelman](https://www.patarnott.com/atms411/pdf/class2018/TwighlightColors2005.pdf)); Purpurlicht im Zenit ([DTIC](https://apps.dtic.mil/sti/tr/pdf/ADA526105.pdf)).
- **Wetter:** Bewölkung dämpft Farben; Wirkung von Wetter auf Stimmung ist individuell sehr verschieden ([Klimstra et al. 2011](https://pubmed.ncbi.nlm.nih.gov/21842988/)).

## Geplante Umsetzung
1. Jede Wada-Kombination bekommt Merkmale: mittlere Helligkeit, Sättigung, Farbton-Spanne, warm/kühl, Helligkeitskontrast.
2. Jede Situation (Nacht, blaue Stunde, Morgenrot, Morgen, Tag, goldene Stunde, Sonnenuntergang, Regen, Nebel, Schnee, schwere/leichte Stimmung, Jahreszeit) hat ein Zielprofil, z.B. Nacht = dunkel, kühl (dunkelgrün/blau, Wunsch), wenig gesättigt.
3. Die App wählt die passendste Kombination (mit täglicher Variation) für den Kreis und lässt den Hintergrund durch 2–3 benachbarte Kombinationen fliessen.
4. Vorschau-Blatt aller Situationen → Freigabe durch dich.
