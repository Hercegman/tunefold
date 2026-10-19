"""Smart artist folding.

Problem: Spotify credits the same artist differently across albums ("Silk Sonic"
vs "Bruno Mars, Anderson .Paak, Silk Sonic", "Beyoncé" vs "Beyonce"). Anyone who
sorts a collection alphabetically ends up with one artist scattered over several
places.

The solution works purely with names as the user sees them:
  1. name key = no diacritics, no punctuation, casefolded, leading "the" dropped
  2. same key, different spelling      -> unify on the most common spelling
  3. credit A is a proper subset of B  -> same act, filed twice. Fold under
     whichever of the two carries MORE tracks, so a side project joins the big
     catalogue rather than a discography being buried under a collaboration.
  4. exception: "(feat. X)" in the title. X is not a co-equal artist, so the
     track goes under the primary artist rather than "Primary, X".
Everything is only a suggestion: the user confirms, renames or rejects, and the
decision is stored as an alias (library.py) that applies to future playlists.
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
    to: str                        # proposed canonical name
    sources: list[str]             # original credits being folded
    track_ids: list[str]
    count_to: int                  # how many tracks already carry the target name
    alternatives: list[str] = field(default_factory=list)
    applied: bool = False          # true when it comes from a stored alias
    reason: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class TrackCredit:
    id: str
    title: str
    artists: list[str]


def analyze(tracks: list[TrackCredit], aliases: dict[str, str] | None = None) -> dict:
    """Return {"artist_map": {track_id: name}, "suggestions": [...]}.

    artist_map is the name that would apply if the user accepted everything.
    The frontend may change it freely before downloading.
    """
    aliases = aliases or {}
    # 1. most common spelling per name key
    spellings: dict[str, Counter] = defaultdict(Counter)
    for t in tracks:
        for a in t.artists:
            spellings[norm_key(a)][a.strip()] += 1
    canon_spelling = {k: c.most_common(1)[0][0] for k, c in spellings.items()}

    def display(names: list[str]) -> str:
        return ", ".join(canon_spelling[norm_key(a)] for a in names)

    # 2. effective credit (without feat.) per track, grouped by key set
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

    # alias suggestions (already applied, shown for transparency)
    by_alias: dict[str, list[TrackCredit]] = defaultdict(list)
    for t in tracks:
        if t.id in artist_map:
            by_alias[artist_map[t.id]].append(t)
    for to, ts in by_alias.items():
        srcs = sorted({", ".join(t.artists) for t in ts})
        suggestions.append(Suggestion(
            id=f"alias:{norm_key(to)}", kind="alias", to=to, sources=srcs,
            track_ids=[t.id for t in ts], count_to=len(ts), applied=True,
            reason="Saved rule from a previous playlist.",
        ))

    # 3. display order of a key set = the most common Spotify order
    def group_display(keyset: frozenset) -> str:
        orders = Counter(display(eff_names[t.id]) for t in groups[keyset])
        return orders.most_common(1)[0][0]

    group_name = {ks: group_display(ks) for ks in groups}
    for ks, ts in groups.items():
        for t in ts:
            artist_map[t.id] = group_name[ks]

    # 4. spelling suggestions: same key, several spellings
    for k, c in spellings.items():
        if len(c) > 1:
            to = canon_spelling[k]
            others = [s for s in c if s != to]
            ids = [t.id for t in tracks if any(norm_key(a) == k and a.strip() != to for a in t.artists)]
            suggestions.append(Suggestion(
                id=f"spelling:{k}", kind="spelling", to=to, sources=others, track_ids=ids,
                count_to=c[to], reason="Same name, different spelling (case, diacritics, punctuation).",
            ))

    # 5. feat suggestions: a track with "(feat. X)" goes under the primary artist
    for to, ts in feat_tracks.items():
        srcs = sorted({", ".join(t.artists) for t in ts})
        suggestions.append(Suggestion(
            id=f"feat:{norm_key(to)}", kind="feat", to=to, sources=srcs,
            track_ids=[t.id for t in ts], count_to=len(groups.get(frozenset(norm_key(a) for a in eff_names[ts[0].id]), [])),
            reason="A guest from the title (feat.) is not a co-equal artist; the track goes under the primary one.",
        ))

    # 6. overlapping credits: "Silk Sonic" and "Bruno Mars, Anderson .Paak, Silk
    #    Sonic" are one act filed twice. Which name wins is decided by how many
    #    tracks each carries, NOT by which credit is wider. Folding every narrow
    #    credit into the wider one buries a whole discography under a one-off
    #    collaboration: solo "Bruno Mars" is a subset of the trio credit, so a
    #    width-only rule files 24K Magic under Silk Sonic.
    keysets = list(groups)

    def rank(ks: frozenset) -> tuple:
        """Bigger catalogue wins; ties go to the wider credit, then by name."""
        return (len(groups[ks]), len(ks), group_name[ks])

    related = {ks: [p for p in keysets if p != ks and (p < ks or ks < p)] for ks in keysets}
    target_of: dict[frozenset, frozenset] = {}
    for ks, partners in related.items():
        if not partners:
            continue
        best = max(partners, key=rank)
        if rank(best) > rank(ks):
            target_of[ks] = best

    def final_target(ks: frozenset) -> frozenset:
        """Follow a chain of folds to its end. rank strictly increases along the
        way so this terminates; the seen set guards against equal-rank ties."""
        seen = {ks}
        while ks in target_of and target_of[ks] not in seen:
            ks = target_of[ks]
            seen.add(ks)
        return ks

    merged_into: dict[frozenset, list[frozenset]] = defaultdict(list)
    for ks in target_of:
        dest = final_target(ks)
        if dest != ks:
            merged_into[dest].append(ks)

    for target, sources in merged_into.items():
        to = group_name[target]
        ids = [t.id for ks in sources for t in groups[ks]]
        for tid in ids:
            artist_map[tid] = to
        # alternatives: every other credit this one overlaps with, so the reverse
        # direction is always one click away
        alts = sorted({group_name[ks] for ks in sources}
                      | {group_name[p] for ks in sources for p in related[ks] if p != target})
        suggestions.append(Suggestion(
            id=f"merge:{credit_key(to.split(', '))}", kind="merge", to=to,
            sources=[group_name[ks] for ks in sources], track_ids=ids,
            count_to=len(groups[target]), alternatives=alts,
            reason="These credits are the same act written two ways; this name carries "
                   "the most tracks, so everything goes under it.",
        ))

    suggestions.sort(key=lambda s: ({"alias": 0, "merge": 1, "feat": 2, "spelling": 3}[s.kind], -len(s.track_ids)))
    return {"artist_map": artist_map, "suggestions": [s.to_dict() for s in suggestions]}


if __name__ == "__main__":  # smoke test: python -m backend.app.artists
    from collections import Counter

    def show(label: str, tracks: list[TrackCredit]) -> None:
        r = analyze(tracks)
        print(f"\n{label}")
        for s in r["suggestions"]:
            print(f"  [{s['kind']:8}] {' | '.join(s['sources'])}  ->  {s['to']}")
        print(f"  folders: {dict(Counter(r['artist_map'].values()))}")

    show("every rule at once", [
        TrackCredit("1", "Smokin Out The Window", ["Silk Sonic"]),
        TrackCredit("2", "Leave the Door Open", ["Bruno Mars", "Anderson .Paak", "Silk Sonic"]),
        TrackCredit("3", "Skate", ["Bruno Mars", "Anderson .Paak", "Silk Sonic"]),
        TrackCredit("5", "Halo", ["Beyoncé"]),
        TrackCredit("6", "Crazy In Love", ["Beyonce"]),
        TrackCredit("7", "expectations (feat. Chappell Roan)", ["Olivia Rodrigo", "Chappell Roan"]),
        TrackCredit("8", "vampire", ["Olivia Rodrigo"]),
        TrackCredit("9", "I Write Sins Not Tragedies", ["Panic! At The Disco"]),
        TrackCredit("10", "High Hopes", ["Panic at the Disco"]),
    ])

    # direction is decided by catalogue size. A wide credit must not swallow a
    # bigger solo catalogue just because it contains it.
    show("side project does not swallow the solo catalogue", [
        *[TrackCredit(f"b{i}", f"Solo {i}", ["Bruno Mars"]) for i in range(15)],
        *[TrackCredit(f"s{i}", f"Sonic {i}", ["Bruno Mars", "Anderson .Paak", "Silk Sonic"]) for i in range(2)],
        TrackCredit("x", "Smokin Out The Window", ["Silk Sonic"]),
    ])

    show("one collaboration does not merge two discographies", [
        *[TrackCredit(f"a{i}", f"A {i}", ["Artist A"]) for i in range(20)],
        *[TrackCredit(f"b{i}", f"B {i}", ["Artist B"]) for i in range(15)],
        TrackCredit("c", "One Off", ["Artist A", "Artist B"]),
    ])

    show("a real group filed two ways still folds together", [
        *[TrackCredit(f"g{i}", f"G {i}", ["Bruno Mars", "Anderson .Paak", "Silk Sonic"]) for i in range(6)],
        *[TrackCredit(f"n{i}", f"N {i}", ["Silk Sonic"]) for i in range(3)],
    ])
