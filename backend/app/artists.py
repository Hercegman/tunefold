"""Pametno grupiranje izvođača.

Problem: Spotify isti bend kreditira različito po albumima ("Majke" vs
"Goran Bare, Majke", "Bijelo Dugme" vs "Bijelo dugme"). Tko slaže kolekciju
po abecedi dobije isti bend raspršen na više mjesta.

Rješenje radi isključivo s imenima kako ih korisnik vidi:
  1. ključ imena = bez dijakritika, bez interpunkcije, casefold, bez "the"
  2. isti ključ, različit zapis  -> ujednači na najčešći zapis (spelling)
  3. kredit A je pravi podskup kredita B -> predloži spajanje pod ŠIRI naziv
     ("Majke" -> "Goran Bare, Majke")
  4. iznimka: "(feat. X)" u naslovu. Tada X nije ravnopravan izvođač pa se
     pjesma vodi pod glavnim izvođačem, a ne pod "Glavni, X".
Sve je samo prijedlog: korisnik potvrđuje, mijenja ime ili odbija, a odluka se
pamti kao alias (library.py) i vrijedi za buduće playliste.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field, asdict

FEAT_RE = re.compile(
    r"[\(\[\-–]\s*(?:feat\.?|ft\.?|featuring|with|w/)\s+([^\)\]]+?)\s*(?:[\)\]]|$)"
    r"|\s(?:feat\.?|ft\.?|featuring)\s+(.+?)\s*$",
    re.I,
)
SPLIT_NAMES_RE = re.compile(r"\s*(?:,|&|\+|/| and | x | i )\s*", re.I)
TRANSLIT = str.maketrans({"đ": "d", "Đ": "D", "ł": "l", "Ł": "L", "ø": "o", "Ø": "O", "ß": "ss", "æ": "ae", "Æ": "AE"})
PUNCT_RE = re.compile(r"[^\w\s]", re.U)


def norm_key(name: str) -> str:
    s = name.translate(TRANSLIT)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = PUNCT_RE.sub(" ", s).casefold()
    s = re.sub(r"\s+", " ", s).strip()
    if s.startswith("the "):
        s = s[4:]
    return s


def featured_in_title(title: str) -> list[str]:
    out: list[str] = []
    for m in FEAT_RE.finditer(title or ""):
        chunk = m.group(1) or m.group(2) or ""
        out.extend(p.strip() for p in SPLIT_NAMES_RE.split(chunk) if p.strip())
    return out


def effective_artists(title: str, artists: list[str]) -> list[str]:
    """Credited artists minus those the title itself marks as 'feat.'."""
    if len(artists) <= 1:
        return list(artists)
    feat = {norm_key(f) for f in featured_in_title(title)}
    if not feat:
        return list(artists)
    kept = [a for a in artists if norm_key(a) not in feat]
    return kept or artists[:1]


def credit_key(artists: list[str]) -> str:
    return "|".join(sorted(norm_key(a) for a in artists))


@dataclass
class Suggestion:
    id: str
    kind: str                      # merge | spelling | feat | alias
    to: str                        # predloženo kanonsko ime
    sources: list[str]             # originalni krediti koji se spajaju
    track_ids: list[str]
    count_to: int                  # koliko pjesama već nosi ciljno ime
    alternatives: list[str] = field(default_factory=list)
    applied: bool = False          # true kad dolazi iz spremljenog aliasa
    reason: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class TrackCredit:
    id: str
    title: str
    artists: list[str]


def analyze(tracks: list[TrackCredit], aliases: dict[str, str] | None = None) -> dict:
    """Vrati {"artist_map": {track_id: ime}, "suggestions": [...]}.

    artist_map je ime koje bi se primijenilo kad korisnik prihvati sve
    predloženo. Frontend ga može izmijeniti po volji prije downloada.
    """
    aliases = aliases or {}
    # 1. najčešći zapis po ključu imena
    spellings: dict[str, Counter] = defaultdict(Counter)
    for t in tracks:
        for a in t.artists:
            spellings[norm_key(a)][a.strip()] += 1
    canon_spelling = {k: c.most_common(1)[0][0] for k, c in spellings.items()}

    def display(names: list[str]) -> str:
        return ", ".join(canon_spelling[norm_key(a)] for a in names)

    # 2. efektivni kredit (bez feat.) po pjesmi, grupiran po skupu ključeva
    groups: dict[frozenset, list[TrackCredit]] = defaultdict(list)
    eff_names: dict[str, list[str]] = {}
    suggestions: list[Suggestion] = []
    artist_map: dict[str, str] = {}
    feat_tracks: dict[str, list[TrackCredit]] = defaultdict(list)   # display -> tracks

    for t in tracks:
        eff = effective_artists(t.title, t.artists)
        eff_names[t.id] = eff
        alias_key = credit_key(t.artists)
        if alias_key in aliases:
            artist_map[t.id] = aliases[alias_key]
            continue
        if eff != list(t.artists):
            feat_tracks[display(eff)].append(t)
        groups[frozenset(norm_key(a) for a in eff)].append(t)

    # alias prijedlozi (već primijenjeni, samo za prikaz)
    by_alias: dict[str, list[TrackCredit]] = defaultdict(list)
    for t in tracks:
        if t.id in artist_map:
            by_alias[artist_map[t.id]].append(t)
    for to, ts in by_alias.items():
        srcs = sorted({", ".join(t.artists) for t in ts})
        suggestions.append(Suggestion(
            id=f"alias:{norm_key(to)}", kind="alias", to=to, sources=srcs,
            track_ids=[t.id for t in ts], count_to=len(ts), applied=True,
            reason="Spremljeno pravilo iz prethodnih playlisti.",
        ))

    # 3. redoslijed imena za prikaz skupa = najčešći Spotify redoslijed
    def group_display(keyset: frozenset) -> str:
        orders = Counter(display(eff_names[t.id]) for t in groups[keyset])
        return orders.most_common(1)[0][0]

    group_name = {ks: group_display(ks) for ks in groups}
    for ks, ts in groups.items():
        for t in ts:
            artist_map[t.id] = group_name[ks]

    # 4. spelling prijedlozi: isti ključ, više zapisa
    for k, c in spellings.items():
        if len(c) > 1:
            to = canon_spelling[k]
            others = [s for s in c if s != to]
            ids = [t.id for t in tracks if any(norm_key(a) == k and a.strip() != to for a in t.artists)]
            suggestions.append(Suggestion(
                id=f"spelling:{k}", kind="spelling", to=to, sources=others, track_ids=ids,
                count_to=c[to], reason="Isto ime, različit zapis (velika slova, dijakritici, interpunkcija).",
            ))

    # 5. feat prijedlozi: pjesma s "(feat. X)" ide pod glavnog izvođača
    for to, ts in feat_tracks.items():
        srcs = sorted({", ".join(t.artists) for t in ts})
        suggestions.append(Suggestion(
            id=f"feat:{norm_key(to)}", kind="feat", to=to, sources=srcs,
            track_ids=[t.id for t in ts], count_to=len(groups.get(frozenset(norm_key(a) for a in eff_names[ts[0].id]), [])),
            reason="Gost iz naslova (feat.) nije ravnopravan izvođač; pjesma ide pod glavnog.",
        ))

    # 6. podskup -> nadskup: "Majke" -> "Goran Bare, Majke"
    keysets = list(groups)
    maximal = [ks for ks in keysets if not any(ks < other for other in keysets)]
    merged_into: dict[frozenset, list[frozenset]] = defaultdict(list)
    ambiguous: dict[frozenset, list[frozenset]] = {}
    for ks in keysets:
        supers = [m for m in maximal if ks < m]
        if not supers:
            continue
        supers.sort(key=lambda m: (-len(groups[m]), -len(m)))
        merged_into[supers[0]].append(ks)
        if len(supers) > 1:
            ambiguous[ks] = supers
    for target, sources in merged_into.items():
        to = group_name[target]
        ids = [t.id for ks in sources for t in groups[ks]]
        for tid in ids:
            artist_map[tid] = to
        # alternative: obrnuti smjer (sve pod uže ime), plus drugi nadskupovi kad ih ima više
        alts = sorted({group_name[ks] for ks in sources}
                      | {group_name[m] for ks in sources for m in ambiguous.get(ks, []) if m != target})
        suggestions.append(Suggestion(
            id=f"merge:{credit_key(to.split(', '))}", kind="merge", to=to,
            sources=[group_name[ks] for ks in sources], track_ids=ids,
            count_to=len(groups[target]), alternatives=alts,
            reason="Uži kredit je dio šireg; sve ide pod šire ime da bude zajedno po abecedi.",
        ))

    suggestions.sort(key=lambda s: ({"alias": 0, "merge": 1, "feat": 2, "spelling": 3}[s.kind], -len(s.track_ids)))
    return {"artist_map": artist_map, "suggestions": [s.to_dict() for s in suggestions]}


if __name__ == "__main__":  # mali smoke test
    demo = [
        TrackCredit("1", "Teške boje", ["Majke"]),
        TrackCredit("2", "Budi ponosan", ["Goran Bare", "Majke"]),
        TrackCredit("3", "Ljubav je kao ljetna kiša", ["Goran Bare", "Majke"]),
        TrackCredit("4", "Ja sam budućnost", ["Goran Bare"]),
        TrackCredit("5", "Zar je ljubav spala na to", ["Bijelo Dugme"]),
        TrackCredit("6", "Lipe cvatu", ["Bijelo dugme"]),
        TrackCredit("7", "expectations (feat. Chappell Roan)", ["Olivia Rodrigo", "Chappell Roan"]),
        TrackCredit("8", "vampire", ["Olivia Rodrigo"]),
        TrackCredit("9", "Mrak", ["Prljavo Kazalište"]),
        TrackCredit("10", "Heroj ulice", ["Prljavo kazalište"]),
    ]
    import json
    print(json.dumps(analyze(demo), ensure_ascii=False, indent=1))
