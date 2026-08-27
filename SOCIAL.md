# Social Dynamics

This document describes the implemented social systems in AI Town: how villagers meet, remember one another, exchange information, form beliefs, react to conduct, and resolve village-wide disputes.

## Social state

Each villager has a name, job, personality, needs, emotional state, reputation, memories, relationships, fears, grudges, alliances, faith, deity beliefs, and personal beliefs about circulating rumours. Personality traits—aggression, friendliness, curiosity, caution, ambition, and creativity—range from 0 to 1 and influence conversations, reactions, justice preferences, invention, mutation, and violence. All six scores and the villager's strongest trait are visible in the agent panel. Every decision and replacement schedule receives explicit guidance connecting friendliness to cooperation, caution to safety, curiosity to investigation, aggression to confrontation or opportunism, ambition to leadership or self-advancement, and creativity to improvisation.

Social decisions are event-driven. A villager asks the LLM for a response when a schedule block ends, an encounter occurs, an interaction affects them, or notable information reaches them. Requests are serialized to preserve event order. Failed ordinary requests retry; court requests use bounded retries and fallback statements so proceedings cannot remain blocked indefinitely.

Schedule gaps are displayed as `waiting for the next activity`, not as an active `idle` action. An inactivity watchdog tracks villagers who have no task, movement, conversation, reaction, or pending decision. After 15 simulated minutes it prioritizes an `idle_recovery` decision, selects the nearest living villager who is available, and enforces movement toward them followed by a conversation. If nobody is available, the inactive villager takes up useful work instead.

## Encounters and conversations

- Nearby villagers can notice one another and begin an exclusive two-person conversation.
- Known villagers acknowledge each other on encounter. Unfamiliar villagers use a configurable greeting chance.
- A pair triggers once upon entering encounter range and must separate before another encounter can occur.
- An agent already in a conversation cannot join another one.
- Conversations store exchanges and contextual topics for later LLM turns.
- Conversations close after their turn limit, prolonged inactivity, excessive separation, death, court summons, or another forced interruption.
- Inactivity closure pauses while either participant has a queued or pending decision, preventing serialized LLM latency from prematurely ending the exchange.

Conversations are the primary channel for natural rumour propagation. A claim is transmitted only when dialogue actually refers to it.

## Relationships

Relationships are tracked in both directions with a numeric strength and a classified type:

- `neutral`
- `friend`
- `enemy`
- `ally`
- `romantic`
- `fear`

Friendly conversations and help improve relationships. Attacks, theft, and harmful conduct reduce them. Strength above 70 can classify a relationship as friendship; strength below 30 can classify it as enmity. Relationships influence LLM choices, reactions to accusations, willingness to help, hostility, justice preferences, and court votes.

## Direct social actions

Villagers may:

- Talk and continue conversations.
- Help an injured villager, restoring health and improving social standing.
- Attack and injure or kill another villager.
- Steal from another villager.
- Flee from danger.
- Build, work, gather, rest, eat, sleep, or damage property in ways that can become socially significant events.

Witnesses within observation range receive memories of violence, theft, death, help, and destruction. Significant harmful events can seed natural rumours. Death removes the victim from active life while leaving a body in the world, and witnesses can spread news of the death.

A villager whose health falls below 50 is compelled toward recovery: once their sleep and hunger needs are already satisfied, and they are not mid-sleep, mid-flee, or mid-attack, they head to the apothecary and work there for treatment. This compulsion latches on below the threshold and holds until health is fully restored, rather than releasing the instant health ticks back above 50. Only permanently insane villagers are excluded, matching how they are already excluded from the ordinary nightly sleep schedule.

Attacks are explicit recorded events classified as `violent_incident`, including the attacker, victim, damage, resulting health, survival, causation, and witnesses. Every attack creates a distinct event-backed belief, even when the same attacker strikes the same victim repeatedly in one day. The victim forms this belief from direct personal experience with believer stance and full confidence; they do not receive it as hearsay from their attacker. The natural-rumour representation retains the attack event as its evidence source.

Every agent-on-agent attack has a 10% chance to become an immediate lethal strike. A lethal strike deals the target's remaining health as damage and otherwise follows the normal death, witness, memory, relationship, and rumour flow.

A surviving victim may immediately begin fearing the attacker, holding a grudge, or both. Fear is more likely for cautious victims, grudges are more likely for aggressive and less-friendly victims, and more severe injuries increase both chances. These reactions store the attacker's identity persistently and are recorded in the attack event data without creating duplicate fear or grudge entries.

A villager who survives an attack interrupts their current task and seeks an authoritative living agent. They prefer the Sheriff, then a Nurse or Paramedic, then the highest-reputation available villager. The victim travels toward that authority to report the attacker and request protection, care, or investigation; the authority simultaneously receives a priority prompt to meet and assist them.

## Reputation

Reputation ranges from 0 to 100 and affects how credible a villager is as a rumour source. Implemented conduct changes include:

- Attack: reputation loss; lethal attacks carry a larger loss.
- Successful theft: reputation loss.
- Building destruction: reputation loss.
- Healing another villager: reputation gain.

The generated village includes a workplace for every medieval job: the
blacksmith works at the smithy, carpenter at the carpenter's workshop,
merchant at the market, town guard at the guardhouse (or town square), healer
at the apothecary, steward at the manor, innkeeper at the tavern, farmer at the
farm, and priest at the church. Procedural building names and descriptions use
the same medieval setting.

Building footprints maintain a two-tile clearance from one another and cannot
consume road or water tiles. Road-side placement accounts for the complete
width or height of a building on both sides of the road, with a deterministic
free-space fallback when randomized placement fails. Loading an older save
rebuilds building tiles and relocates overlapping rectangles. Building labels
are constrained inside their footprints so long medieval names do not visually
overlap neighboring structures.

Priests do not learn cult membership merely by witnessing suspicious conduct or
hearing a report. They must first complete an investigation of a cult-related
claim to establish that a cult exists. This grants private knowledge of the
group, but not its membership. The priest can then use `interrogate` on one
named villager at a time; a successful interrogation privately reveals an
actual cult affiliation. Only then can the priest become hostile toward that
cultist, with the chance scaling with faith and aggression and producing an
enemy relationship and grudge. Cultists use the same interrogation action to
try to reveal actual anti-cult group members. Results are private to the
interrogator and target rather than announced town-wide.

A named rumour alleging that a villager belongs to a cult or participates in
cult activity is court-eligible. A Priest who has heard and believes the claim
with at least ordinary confidence can call a resolution court before the rumour
has reached the whole village; the Priest then distributes the allegation as
the convening authority. The court event records which Priest called it. A
vague claim that a cult exists remains an investigation matter because a court
still requires a named accused villager.

Outsiders may enter in response to escalating village conditions. Once two
non-exile deaths exist, one Knight is generated at a walkable map edge, enters
the town, and heads toward the guardhouse. After a Priest has successfully
interrogated and privately confirmed at least two distinct cultists, the Priest
may choose `call_inquisitor`. This creates one Inquisitor at the town edge and
routes them toward the church. The Inquisitor receives the calling Priest's
confirmed cult evidence and can continue cult investigations and
interrogations. Each outsider arrival is logged and announced as an arrival;
the one-time arrival flags and outsider identity persist in saved games. Each
arrival now also fires its own Story Narration moment (`knight_called` /
`inquisitor_called`), and an outsider's death in combat fires a matching
`knight_killed` / `inquisitor_killed` moment.

Cultists detect nearby priests and replace preaching, recruitment, prayer,
interrogation, and visible rites with an innocuous activity. The completion
check runs again in case a priest arrives mid-rite. Cult-ability memories are
local and exclude priests, preventing the former town-wide broadcast from
revealing hidden cult activity.

`summon` is a leader-directed collective cult rite. Only a living founder or
leader may begin it, and the action must name an exact known building as the
ritual site. The full building footprint and a one-tile boundary must contain
no living agents when selected. An occupied request falls back to an empty
church and then another empty known building; if none exists, the summoning is
postponed. The leader first visits each of the two selected cultists and
personally tells them to follow for a summoning ritual. Each cultist begins
following immediately after that logged statement. Because membership already
establishes cooperation, invitations automatically acknowledge acceptance and
never request an LLM response. Any existing conversation is closed for both
participants and its queued acknowledgement is discarded before following.
The leader waits until both
followers have gathered nearby, then leads the procession to the chosen site.
When approaching an invitee, the leader paths to the nearest free walkable tile
within speaking range instead of attempting to enter the cultist's occupied
tile. Alternate approach tiles are tried when the nearest route is blocked.
If an unrelated agent enters the reserved area before completion, the party
switches to another empty reachable building when one is available; otherwise
it waits for the location to clear rather than counting or displacing them.
Followers continue closing to within 1.5 tiles of the leader, ensuring they can
satisfy the ritual's two-tile completion radius instead of stalling just outside it.
Once travel begins, each follower receives a distinct walkable ritual slot
within one tile of the site center. These fixed destinations replace stale
leader-chasing paths and are recalculated whenever the ritual site changes.
Completion waits until the leader and both participants are within two tiles of the chosen
location; if fewer than three valid members remain, the attempt fails and logs
the member count. Each successful rite grants the user one Demon summon charge
and records that chosen location as the Demon's future spawn point. Creating a
Demon consumes one charge and requires a non-empty user command. The Demon
controls show a live travel-progress bar, the leader and cult name, the chosen
site, and how many of the three required participants have gathered.

When a leader's daily plan contains a valid summoning block, the two selected
cult members receive coordinated participation blocks with the same start,
duration, and destination. Conflicting activities in that window are replaced,
while later plans are retained. Runtime gathering reuses these scheduled members
so the displayed plan and the actual ritual participants remain consistent.

An accepted divine whisper that explicitly commands summoning becomes an
executable prophetic `summon` task for a cult leader. The interpretation must
choose a real building; an invalid or omitted location falls back to the church
and then another known building. Older saves whose accepted summon whisper
produced only thoughts are reopened when no summon task, charge, or Demon exists.

Demons receive no autonomous schedules, fallback work, idle recovery,
conversations, or LLM decisions: they remain inert except while
executing user commands. Commands can direct a Demon toward a named villager or
location, or order it to pursue and attack a named living villager.

Demons have 666 health and ignore all damage—including instant-kill rolls,
divine smiting, court execution, and ordinary attacks—unless the attacker is a
persisted Knight or Inquisitor outsider. Blocked attacks are logged with zero
damage and an invulnerability outcome. Demon charges, created Demons, their
last commands, and ongoing commanded movement persist in saved games.

The instant a Demon is successfully summoned, the entire map's environmental
corruption is slammed to maximum (1.0) rather than only spreading outward
from the summoning site over time — the manifestation's shock reads as
total and immediate. Tiles outside the Demon's own radius of influence still
decay back down afterward through the ordinary corruption mechanics once
nothing else sustains them there.

Living agents within eight tiles see the Demon manifest. Witnesses who belong
to any cult are immune to the manifestation's existential reaction. Every
other witness's schedule and current activity are interrupted immediately and
resolves through the same comprehension/reaction system described below.

A targeted divine `manifest` against a living villager, and every witness of a
resurrection, route through that same system rather than a flat coin flip.

## Environmental decay & weather corruption

The world itself is not immune to the village's spiritual corruption. Three
sources bleed a localized corruption value into nearby tiles: a cult's shrine
(scaled by how many living members it has), a bound Demon (moving with it, and
by far the strongest source), and the site of an active summoning ritual while
it is underway. A corrupted Priest's congregation counts here too even though
it never raises a separate shrine building (see "A corrupted Priest" above):
its rededicated church stands in as the shrine, so the flock's presence taints
the ground around it exactly as an ordinary cult's shrine would. Corruption
spreads with distance falloff from each source,
ramping up gradually over real simulated minutes rather than appearing
instantly, and it is capped by the strength of whatever is causing it — a
small, thinly attended shrine only ever taints its immediate surroundings,
while a Demon's presence can blight a much wider area.

Crossing a visible threshold has two distinct, tile-type-specific consequences,
each narrated only the first time it happens to a given tile:

- A **water tile** turns brackish and foul-smelling.
- A **farm building**'s fields blacken and the crop fails where it stands.

Every other affected tile still visibly carries the corruption — rendered with
a sickly tint and, past a heavier threshold, a persistent, localized fog that
does not lift — without generating its own discrete narrative event, so the
overall effect reads as spreading ambient dread rather than a wall of
repeated announcements. Any living villager near a tile when it first crosses
the visible threshold witnesses it and receives the memory. The very first
time any tile is corrupted in a given village, the moment is chronicled through
the same Story Narration system used for cult foundings and demonic summons.

Corruption is reversible: it only continues to grow within an active source's
radius, and decays back toward zero once nothing sustains it there — a
disbanded cult's shrine losing its congregation, or a Demon moving elsewhere
or being removed, lets the tainted ground gradually heal. This is distinct
from the global weather system (clear/cloudy/rain/storm), which is ambient and
untied to any in-world cause; corruption is always the localized, visible
fingerprint of a specific cult, Demon, or ritual.

### Eldritch Blight

A tile's corruption value on its own is only ever a transient tint: it heals
once whatever is sustaining it goes away. Eldritch Blight is the deeper,
irreversible consequence of letting a tile sit at meaningfully high corruption
for a sustained stretch of simulated time (continuously, not merely having
once peaked there) — a grass tile permanently becomes anomalous, blighted
ground, and a water tile permanently becomes brackish water. Neither ever
reverts to ordinary grass or clear water again, even long after the shrine,
Demon, or ritual responsible is gone and the tile's own transient corruption
has fully faded back to nothing. A demon's presence or an active summoning
site cross the sustained threshold quickly; a lone, sparsely attended shrine
never generates enough intensity on its own to blight anything, while a
large, well-established one eventually can. The very first blight conversion
in a village's history is chronicled through the Story Narration system, the
same way a cult's founding or a Demon's summoning is; every individual
conversion afterward is still recorded as an ordinary witnessed event, just
without its own narrated moment. Blighted ground no longer yields herbs to
`gather` the way ordinary grass does — one of the ways the change is a
genuine mechanical consequence, not only a visual one.

## Existential reactions to forbidden knowledge

Learning something that undermines a villager's basic understanding of their
own reality -- that they're simulated, that an outside operator generates
their thoughts, that their world can be deleted or reset -- no longer
resolves as a binary insane/not-insane roll. It resolves in two stages:

1. **Classification** (whispered text only): an LLM judges whether the text
   is actually forbidden knowledge in this Lovecraftian sense, and how
   directly it states it (severity 0-100). A vague hint (severity below 50)
   unsettles but does nothing further. A witnessed anomaly (a demon
   manifesting, a targeted divine manifestation, a resurrection, or -- for an
   already-obsessed villager -- even a deity-commanded weather change) skips
   straight to stage 2, since these are forbidden by construction.
2. **Reaction**: an LLM -- or, if unavailable, a deterministic fallback keyed
   on personality and belief -- decides whether the villager even comprehends
   what they've learned, and if so, how they specifically come to terms with
   it:
   - **Denial**: they don't have the framework to grasp it, or refuse to.
     Nothing changes.
   - **Reinterpretation**: they fold it into a faith they already hold (a
     religious believer may conclude their god governs even this). Faith and
     deity confidence rise; sanity is untouched.
   - **Obsession**: they stay outwardly functional but become quietly fixated
     on finding more proof. Sanity takes moderate damage. Further witnessed
     anomalies accumulate as evidence in this state rather than re-rolling a
     fresh reaction; once enough evidence accumulates, the obsession resolves
     into either revelation or madness.
   - **Nihilism**: they accept it and conclude nothing they do matters.
     Moderate sanity damage and a dented reputation.
   - **Revelation**: they accept it calmly and remain fully functional,
     genuinely at peace with the truth.
   - **Madness**: their mind breaks. This is the only reaction that sets
     permanent insanity -- the agent is forced back into the panicked
     emotional state, and both daily and triggered prompts require unstable,
     obsessive, fearful, or erratic behavior while preserving valid actions.
     Later reality-breaking moments reinforce the condition; ordinary
     emotional changes, saving, loading, and resurrection cannot cure it.

Any cultist -- a secret prophet, a leader, or an ordinary rank-and-file
member -- is exempt from sanity damage entirely: their conviction in a hidden
truth is unlikely to break someone who has already organized their life
around it. A secret prophet's sanity damage stays hidden behind their calm
public face rather than forcing a visible panic. Every reaction is recorded
as a private witness event and memory. This exemption originally covered
only cult leaders; it now extends to every cultist, and to the equivalent
80%-insanity roll a deity-placed forbidden relic poses to an unbelieving
discoverer (see Forbidden Relics below).
- Passing information later supported by investigation: a small gain.
- Passing information later found unsupported: a larger loss.

A unique speaker affects a claim's credibility once, preventing repeated transmission by the same person from repeatedly inflating or destroying credibility.

## Memories and reactions

Agents keep a recent event buffer plus compacted long-term summaries. Memories include observed actions, conversations, received rumours, investigation findings, court events, and private thoughts. Each rumour delivery and finding creates a private interpretation describing whether that villager believes, denies, or remains uncertain about the claim.

Memories and the current social context are supplied to the LLM for schedules, conversations, reactions, investigations, defenses, and votes.

### World-event reactions

Court verdicts, resurrections, and other notable occurrences (a death, a destroyed building) queue a `world_event` decision trigger for affected villagers. World-event reactions have priority over routine schedules, queued decisions, movement, and ordinary conversations: they close recipients' active conversations, stop their current activity, clear stale queued intentions, invalidate the rest of their daily schedule, and move to the front of the global LLM queue. If a lower-priority LLM response or daily plan was already being generated, that stale result is discarded. Reaction prompts direct villagers to address danger and check on another affected or vulnerable villager when appropriate. Afterward, every recipient generates a fresh schedule using the event and their reactions as memory instead of returning to the pre-event plan.

Each recipient chooses an event-response state such as panicked, grieving, afraid, angry, determined, or ambivalent. The state is stored on the villager and passed into the replacement schedule together with recent event memories. It can therefore produce substantially different behavior—fleeing, checking on others, organizing help, crying, gathering supplies, withdrawing, stealing, attacking, or making only minor changes—according to the event and that villager's personality. Crying is a first-class action and is recorded in memory like other behavior.

When a death report names a villager with whom a recipient has an established relationship, grief is mandatory rather than an optional LLM interpretation. Learning or witnessing the death sets the recipient to `grieving`, creates a private grief memory naming the deceased and relationship, overrides the immediate response's emotional state, and consequently shapes the replacement schedule. Strangers' deaths can still produce other event-response states.

## Rumour origins

Rumours can be:

- `natural`: formed from a recorded theft, injury, death, or destruction event.
- `whisper`: directly planted through the debug interface for one villager or the whole town.
- `invented`: an organic local suspicion created during conversation.
- `mutated`: a distinct branch of an existing claim.

Provenance is separate from factual status. A claim may be attributed to an event, anonymous source, intuition, dream, divine revelation, or mutation. Divine claims may name a deity. Whisper provenance is inferred from the supplied source hint.

Every claim independently tracks text, origin, source, parent, credibility, reach, transmissions, related claims, pending first shares, responses, investigation status, findings, beliefs, and any court session.

## Rumour propagation

- A newly informed villager is prompted to mention the claim to their first subsequent conversation partner other than the person who introduced it.
- Required whisper shares are written by the LLM in the villager's own conversational voice. Raw whisper text is never mechanically appended to dialogue; the prompt requires a paraphrase, a natural bridge from the live topic, and no third-person narration. If the LLM omits the topic, the required-share marker remains for a later turn and clears only when dialogue actually contains the claim.
- Later organic mentions depend on friendliness, authority, and `rumourPropagationMultiplier`.
- Source reputation adjusts credibility once per unique speaker.
- Related claims naming the same person, place, or event can corroborate one another once, increasing credibility up to the configured cap.
- Investigation findings propagate separately; someone may know the claim without yet knowing its finding.
- Resolved claims stop ordinary propagation.

Resolved claims immediately clear required-share markers and stop contributing to propagation or corroboration. They remain visible as recent social history for one simulated day, then archive out of the active rumour tracker along with queued reactions and related-claim links, per the general rumour expiry and history behavior described under Investigation below. Agent memories may retain the historical outcome and are compacted normally. When the active tracker reaches its capacity, new claims replace archived claims first, then resolved claims, before unresolved ones.

## Invention and mutation

Creative villagers can invent suspicions during eligible conversations, subject to `inventedRumourProbability` and a per-agent cooldown.

During a rumour-driven talk, attack, theft, or help interaction, a villager can mutate the motivating root claim. A mutation may escalate the story or soften it with a more benign interpretation. It becomes a new related rumour with independent credibility, reach, beliefs, provenance, and court readiness. If spoken, the changed version is placed directly into dialogue so it can transmit. An agent can create at most one branch from a given parent claim, while unsuccessful mutation rolls may be tried again during later interactions.

When a villager comes to know two related root claims, creativity and curiosity give them a chance to merge the stories into a new combined interpretation. The merged version quotes the substance of both claims, is explicitly associated with both parents, begins with its own reduced credibility, and propagates as a separate mutated rumour. Village-wide pair deduplication allows only one combined branch from the same two parents, regardless of how many villagers later hear both. Existing-branch detection and recursion guards prevent duplicate merges and immediate mutation cascades.

Agent-created claims mark the creator's belief as authored. Authorship prevents the generic self-accusation denial rule from treating a creator's name in wording such as “Marcus believes…” as an accusation against Marcus. A prophetic claim derived from an accepted revelation begins with its Prophet author as a confident believer rather than inheriting an accidental denial; because it is not fixed or seeded, later evidence may still revise that confidence normally.

## Personal belief

Each villager who receives a claim has a personal stance:

- `believer`
- `denier`
- `uncertain`

Non-extreme beliefs use confidence to move between these stances. Credibility, corroborating related claims, provenance, findings, and social consensus can change confidence.

`rumourExtremeBeliefProbability` controls whether first exposure produces a fixed believer or fixed denier. Fixed stances resist later contradictory evidence. Direct whisper recipients are seeded, fixed believers even when the whisper is objectively false or later unsupported, except that atheists reject every whisper as false with a fixed denier belief and cannot become Prophet from it.

The person accused of conduct by a claim initially denies it. Once broad social consensus exists, they receive a one-time small chance to internalize the accusation despite that initial denial. This rule does not apply to every person mentioned in the wording: a direct victim of a recorded attack, theft, or help event accepts the event they personally experienced rather than denying it because their name appears in the claim.

Belief constrains harmful rumour-driven conduct: attacks and theft motivated by a claim require a believer stance and must target the person directly implicated by the claim.

## Faith and divine claims

Villagers have general faith and confidence in named deities. A divine claim may be accepted based on faith, existing deity confidence, provenance, and personal stance. Acceptance can increase faith and deity revelation counts; rejection or an unsupported finding can weaken them.

Every newly generated non-empty town begins with at least one atheist. The lowest-faith generated villager is assigned the atheist worldview, capped at five faith, and starts without deity beliefs or conversion progress; all other villagers begin undecided. The initial atheist's worldview, faith, and deity state remain undisclosed in agent and cult interfaces until they personally reject a cult leader's preaching or recruitment attempt, which records a worldview-revealed event for both participants. Experience in the village shapes other stances over time. Accepting a divine message, a supported divine finding, or a successful conversion can produce a believer. Rejecting a divine claim or learning that it was unsupported can produce a nonbeliever, with low-faith villagers sometimes becoming atheists. Existing saves retain their established worldviews, while older saves without a worldview migrate to undecided rather than receiving a stance inferred from statistics.

The resulting established worldviews are `believer`, `nonbeliever`, and `atheist`. Nonbelievers and especially atheists resist later divine-message acceptance, so even a town-wide divine whisper does not automatically make the whole village religious. Undecided villagers remain comparatively open but do not become believers unless an actual religious experience changes them.

Believers may add a conversion appeal when speaking with a known nonbeliever or atheist. Conversion chance depends on the believer's friendliness and faith and the target's curiosity, caution, and existing stance; atheists are harder to convert. A successful conversion changes the target to believer and raises faith to a viable starting level. A failed attempt can aggravate a highly faithful, aggressive, incautious believer, with a capped chance of attacking the target. Conversion and resulting violence are recorded as social events and memories.

Newly generated villagers never begin as Prophets. The first villager who accepts that God, a deity, or another higher being spoke through a direct divine whisper changes jobs to `Prophet`; invented, mutated, daily prophetic, and other divine-origin rumours cannot appoint one. Appointment is private: it remains visible in the global event log, but only the appointed Prophet observes and remembers it. No town-wide announcement or memory is created, and ordinary job-based greetings and invented claims do not expose the hidden role. A direct divine-whisper recipient is a seed believer, so divine acceptance and the first eligible Prophet appointment are guaranteed rather than subjected to a second random worldview roll. Divine provenance is inferred from the whisper text when the separate source field is blank. The source field recognizes any named higher power, not only "God": generic religious wording ("a god named Dagon," "the great old one Cthulhu") is parsed for the name, and a short, bare, capitalized source with no other classification cue (typing "Dagon" or "Cthulhu" alone) is likewise read as that entity speaking directly, unless it exactly matches a living villager's own name, in which case it is treated as a mundane, non-divine source instead. Existing saves with a seeded divine-whisper believer but no appointed Prophet are repaired automatically. Only one living Prophet may hold the role at a time. If that Prophet dies, the position remains vacant until a new direct divine whisper appoints its living recipient; old revelations are not recycled for succession. The Prophet's old schedule is cleared, prophetic reflection and conversation become their work context, and the role is persisted across saved games.

At the start of every subsequent simulated day, the living Prophet makes one new LLM-generated prophetic claim grounded in their deity beliefs, memories, and current knowledge of the village. The claim enters the rumour system as an unverified divine claim that the Prophet believes and must share naturally in conversation. The completed day is persisted so loading a save cannot produce duplicate daily claims; a non-lethal fallback still creates that day's prophecy if generation repeatedly fails.

Appointment immediately ends the new Prophet's movement, task, schedule, queued intentions, and active conversation. A priority LLM revelation phase then asks the Prophet to interpret the divine command using their personality, faith, memories, relationships, known villagers, jobs, and current circumstances. The private response and emotional state are recorded before any public action. The same interpretation must produce one to three distinct descendant claims; these become associated mutated rumours linked to the original revelation, are believed by the Prophet, and are queued for natural conversational sharing. For example, a vague demand for sacrifice may lead the Prophet to infer who is threatened, whom they suspect should be chosen, what danger they believe approaches, or whether the command should be resisted.

Every later direct divine whisper to the existing Prophet also starts this complete revelation phase; it is not processed as an ordinary rumour. Each revelation is tracked once across saves. Older saves containing an accepted but uninterpreted divine whisper are detected and queued automatically. The Prophet's selected tasks are immediately written to memory—for a sacrifice this explicitly names whom the Prophet chose to die—before the short reflection block and physical execution begin.

Prophetic claim parsing accepts either plain strings or structured objects containing `claim`, `text`, `rumour`, or `statement`. Other object values are rejected rather than coerced into `[object Object]`. Saved malformed prophetic claims are removed with their relationship links and queued reactions, then the original revelation is automatically submitted for a clean reinterpretation.

The interpretation must also return actionable prophetic tasks rather than stopping at rumour creation. Supported tasks include sacrifice, warning, protection, conversion, investigation, and gathering. They remain ahead of routine work and execute sequentially after the Prophet's private reflection. A sacrifice command requires the LLM to select one named living villager other than the Prophet; invalid selections fall back to the Prophet's least-close living acquaintance. The Prophet approaches the selected villager and repeatedly attacks until that villager dies, so a command requiring death is pursued as a persistent objective rather than a single conversational claim. Movement toward other personal tasks similarly continues until the Prophet reaches the target and performs the required interaction.

Runtime construction is disabled. `build` is absent from LLM schedules and
prophetic tasks, the world interaction no longer exposes a construction
handler, and old saved `build` schedule blocks are converted to ordinary work.
The `BUILD` event value remains readable only for compatibility with historical
saved event logs.

Prophetic interpretation requests make four total attempts (the initial request plus three retries). They never retry indefinitely. If all attempts return malformed or incomplete data, a command-aware fallback produces a private response, a related claim, and at least one executable task. Explicit sacrifice language still selects a living target, cult language still produces a formation task, and other revelations produce a warning or investigation, allowing the Prophet and the shared LLM request lane to continue.

`form_cult` is also available as a prophetic task, exclusively to the currently appointed living Prophet. The interpretation LLM may name and found a cult when the revelation and Prophet's personality support organizing followers. Formation makes that Prophet the cult leader; non-Prophets cannot found a cult or recruit on its behalf. Cult identity and leader/member roles persist directly on agent state and appear in the Agent States panel. A later `convert` task approaches a named villager and attempts recruitment; acceptance depends on the Prophet's friendliness and faith, their relationship, and the target's curiosity and caution. Both successful membership and resistance are recorded in each participant's memory and in the event history.

Cult members act as a coordinated voting bloc in resolution court. When the living cult leader is an eligible voter, the leader votes first and establishes the cult's position; every eligible member then casts the same choice under the leader's influence while giving an individual public statement. If the leader cannot vote because they are dead, absent, or accused, the first eligible member establishes the bloc position and the remaining members follow it. Cult influence is included explicitly in each influenced member's recorded reasoning. No cult member may vote to execute a defendant from the same cult; any attempted lethal vote is reduced to exile. Against a nonbeliever or atheist defendant, cult voters may favor execution when they believe a grave accusation warrants punishment.

Cults are non-aggressive toward outsiders by default and have no fixed hostility assigned at founding. Their collective temperament emerges from the average aggression of their living membership. A cult with at least two members and average aggression of 65% or higher periodically has a bounded chance to form a mob; at least two members with 45% aggression must participate. The mob may select a living nonbeliever or atheist outside the cult, pursue them together, and attack on arrival. Mob formation, membership, target, group aggression, and causation are recorded, and each cult has a six-simulated-hour cooldown between mobs.

Cult membership unlocks cult-specific tasks: `pray`, `conjure`, `resurrect`, `heal`, `bless`, `curse`, `ritual`, and `preach`; `summon` and `build_shrine` are reserved for the cult leader. Personality, doctrine, faith, memories, and circumstances determine whether these appear in an LLM decision or daily schedule. Non-members cannot execute them; invalid non-member rites are replaced by ordinary work. Prayer and ritual strengthen faith, healing restores health, blessing improves confidence and reputation, curses frighten and reduce reputation, preaching improves the speaker's standing, and resurrection can restore a specifically named dead villager with partial health and forces that villager to reevaluate their life. A leader's summoning names a building, gathers two fellow members there, and waits for all three participants before producing a Demon charge tied to that location. Conjuring creates a witnessed manifestation event. Direct supernatural effects therefore enter the simulation only as consequences of cult actions rather than arbitrary actions by ordinary villagers.

Preaching now actively seeks converts rather than only sermonizing from the shrine: a preaching cult member first looks for the nearest living, convertible, non-immune villager, and if one exists beyond speaking range, travels toward them before beginning the sermon. With no eligible convert nearby, preaching falls back to gathering at the shrine as before.

### A corrupted Priest

A freshly generated village's Priest already founds and leads a small, established congregation, "The Church of Christ" (see Faith and divine claims), so an ordinary Prophet appointment does not fit them — they are a devout founder, not an undecided villager awaiting a first calling. Instead, a direct divine whisper aimed at that Priest offers a private, probabilistic temptation: a corruption chance derived from their faith, caution, sanity, and curiosity (strong faith and caution resist it; a fraying mind or idle curiosity invite it). Failing the roll leaves the Priest outwardly and internally unchanged beyond a private memory of having resisted; nothing is announced.

Succeeding secretly makes the Priest the true Prophet and cult leader while their public `currentJob` deliberately stays `Priest` — the corrupted-Priest twist this represents (worn openly, à la Lovecraft's Innsmouth) is that nothing about their outward station changes. Moments later, the congregation they already founded is quietly refounded under a new, LLM-generated name evoking something ancient, oceanic, and inhuman; every existing member's own cult record updates to the new name too, since cult membership is stored per-agent rather than by reference, and the corrupted Priest's role advances from founder to leader like any other cult founding. The renaming and appointment are both private: visible only in the global event log and the corrupted Priest's own memory, exactly like an ordinary Prophet appointment.

A corrupted Priest keeps performing ordinary Priest duties as cover — services, counsel, investigation of unrelated allegations — and is deliberately excluded from ever earnestly investigating, interrogating, or calling an Inquisitor against their own true cult or its members. They are also exempt from the daily public prophetic-claim habit and from the vocation rule that strips an ordinary Prophet of all secular work, so their schedule continues to read as a normal Priest's. Existing mechanics that treat cult leadership generically — preaching in place of secular work, summoning, shrine construction reusing the existing church building, voting-bloc behavior in court, and suspicion of a member who defects from "their own flock" — continue to apply unchanged, since none of them depend on the public job title.

Corruption cuts everyone's actual belief in Christ heavily, the Priest included — his own confidence in Christ takes the same steep hit as the flock's, since he is the one who first submitted to the whisper. Every member of the congregation (Priest and flock alike) has their named Christ deity confidence dropped by 65 points, floored at 0, while their confidence in the corrupting deity rises. None of this is visible to the congregants themselves or announced publicly: each still consciously believes they worship Christ as devoutly as ever, per the `flock_corrupted` narration — the drop is a private internal fact rather than a witnessed event, exactly like the rest of the corruption twist.

The debug GUI, however, is not bound by that in-fiction secrecy — it is meant to show a corrupted Priest's true worldview, faith, and deity confidences plainly, the same as it does for any other agent. (A freshly generated village's founding Priest or congregant can occasionally be the same agent randomly chosen as the village's initial atheist before their Christian belief is seeded over it; `seedInitialChristianCult` now explicitly clears that agent's hidden-worldview flag when it overwrites their stance, and the debug GUI additionally only ever treats a worldview as "undisclosed" when the agent's actual stance is `atheist` or `nonbeliever` — an overt believer, corrupted or not, is never displayed as hidden.)

### Cult shrines

A living cult leader or founder may choose `build_shrine` (no target needed) to raise a dedicated shrine for their own cult — a genuinely new building placed on the map near wherever the leader is standing, the same footprint and clearance rules world generation uses for every other building. Only one shrine may exist per cult, and only the leader or founder can commission it; anyone else attempting it, or a leader whose cult already has one, falls back to ordinary work instead. If no legal site can be found nearby, the attempt is recorded as failed rather than crashing or silently doing nothing.

Once a shrine exists, the cult's communal rites gravitate to it rather than happening wherever the member happens to be: `preach` routes the speaker to travel to the shrine before the sermon completes, and `summon` treats the cult's own shrine as its preferred ritual site — outranking a generic church — unless the leader names a different exact building. Solitary rites (`pray`, `heal`, `bless`, `curse`, `resurrect`, `conjure`, `ritual`) remain personal and are unaffected; they still take place wherever the member is. A shrine is a visible cult activity like any other: a leader will not begin building one while a Priest is nearby.

Once a cult reaches at least three living members without yet having a shrine, its leader does not merely have the option to raise one — the leader personally feels compelled to, as though commanded by their own deity. This is deterministic rather than left to an LLM's discretion: it interrupts whatever the leader is currently doing (closing any active conversation, clearing their schedule and queued intentions) and forces `build_shrine` to the front immediately, framed in a private thought naming the leader's own deity. This compulsion is issued at most once per cult; if the leader never manages to complete it, it is not repeated, and it is not reissued for a cult that already has a shrine.

Prayer and ritual can create persistent structured cult requests, with a six-hour per-cultist request cooldown and one-day expiry for unanswered wishes. Requests respond to real circumstances and may ask for an injured member to be healed, another member or leader to be blessed, safer weather, greater cult influence and membership, more power for the leader, or punishment of a nonbeliever. Matching cult abilities and God interventions mark requests fulfilled and preserve the fulfilling event ID. Pending requests and their status appear in agent prompts and the cult-details popup.

When a cult is founded, its leader develops one or more persistent agendas from personality. Ambitious leaders may seek personal power or village influence, friendly leaders favor peaceful expansion, and highly aggressive leaders may seek to remove or kill nonbelievers. Agendas shape the leader's generated requests and are shown with an intensity score in the cult-details popup.

An unanswered request that expires can make its requester feel forsaken, especially when faith is low, aggression is high, and caution is low. After at least two simulated hours of desperation, the cultist periodically has a bounded chance to seek God's attention through sacrifice. Faith and low ambition favor self-sacrifice; ambitious cultists may instead sacrifice the least-close fellow member currently within interaction range. Sacrifice is immediately lethal, uses the standard violent-event, death, witness, memory, relationship, reputation, and rumour flows, and grants two God invocation credits. A fulfilled request clears the requester's desperation before sacrifice occurs. The cult-details popup and prompts expose active feelings of abandonment and sacrificial consideration.

Ordinary cult members can defect when low faith, expired prayers, or feelings of abandonment create sufficient disillusionment. Cult leaders and founders never voluntarily abandon their cult; leadership changes only through death, exile, or formal succession. Member defection is checked at most hourly and remains probabilistic. A defector permanently records former membership, loses current cult requests and rites, and is formally marked as an enemy of the former cult; remaining members gain a grudge and enemy relationship toward them. Based on ambition, aggression, and curiosity, the defector may found a named anti-cult group or join an existing group opposing the same cult. Anti-cult affiliation and former-cult hostility persist in saves, enter prompts, appear in the Cults & Groups tracker, and appear under defectors and enemies in the former cult's details popup.

When the departed cult is led by a Priest — their own flock — that Priest always grows suspicious of the departing member and personally investigates them, the same authoritative way a Priest investigates any other cult-related allegation. This is deterministic rather than probabilistic: the Priest privately forms an unresolved suspicion naming the departed member, which guarantees their next decision devotes an investigation to that specific member rather than a random bystander.

Every successful departure emits a persistent `cult_defection` event into the shared event history and save data. The event records the defector, former cult and role, simulated departure time, enemy marking, remaining members, probability that produced the departure, and any anti-cult group and role. It is copied into the defector's and remaining members' memories and appears with a distinct color in both event-log interfaces.

Cult intent is also inferred from descendant prophetic claims. If the Prophet creates a claim mentioning a cult, religious group, fellowship, sect, or order of followers but the LLM omitted `form_cult`, the simulation synthesizes that task and extracts a stated group name when possible. This reconciliation also repairs existing saves where a cult claim exists but the Prophet never acted on it.

Cult founding is committed atomically when the formation action starts rather than waiting for its timed activity block to finish. This prevents queued reactions, schedule changes, or save/reload from replacing the block before membership state exists. Ordinary queued decisions also wait for an active block to complete; only priority world events and new revelations may interrupt one.

Strong believers may be compelled to share divine claims. Under sufficiently extreme conditions, religious conviction can develop into fervour directed at an implicated living person, causing pursuit and possible attack. This is an individual emergent action, not a formal village resolution.

## Investigation

Rumour status moves through:

- `unverified`
- `investigating`
- `verified`
- `unsubstantiated`
- `resolved`

Relevant professions can investigate claims within their authority. The Sheriff treats every unresolved rumour they hear as a priority, including multiple separate claims, and may investigate even when another profession is already doing so.

Investigators travel, seek interviewees or evidence, and produce a finding. Recorded supporting events can verify natural claims. Authoritative investigation of a controlled whisper uses its configured objective truth. A verified finding raises credibility and normally moves non-fixed villagers toward belief; an unsubstantiated finding lowers credibility and normally moves them toward denial. Fixed and seeded stances remain resistant.

Investigation determines evidence but does not block court eligibility once an accusation has reached the entire living village.

When an authoritative investigation concludes, the moment is timestamped on the claim and the Rumour & Belief Tracker marks the card with an explicit "✓ Verified" or "✗ False" badge alongside its status, distinct from the ordinary status color coding.

### Rumour expiry and history

Every rumour eventually leaves the active tracker, not only claims resolved by village consensus. A resolved claim keeps one simulated day of visibility; a claim an authority investigated but that the village never otherwise resolved keeps one simulated day from the finding; and a claim nobody ever investigated or resolved keeps three simulated days from when it first appeared. Once that window closes, the claim stops contributing to propagation, corroboration, investigation assignment, and court eligibility — the same way a resolved claim already does — but instead of being deleted it is archived in place with a compact timeline (created, investigated with outcome, and court verdict if any). The tracker renders archived claims as a minimized, greyed-out, collapsed-by-default "Historical rumours" list, kept as a record rather than shown alongside active claims. Archived claims are still the first to be evicted if the active-rumour tracker reaches its overall capacity.

## Individual justice responses

A villager can classify their own response as:

- `gossip`: treat the claim as ordinary social information.
- `court`: personally prefer a formal hearing.
- `vigilante`: consider direct mob-style action.

These labels depend on belief, alleged seriousness, crowd support, personality, and relationship with the accused. Vigilantes may confront, warn, attack, steal, or stand down. Individual justice preferences are displayed for social insight but do not determine whether the village court convenes.

## Village-wide resolution

### Resolution by rejection

A non-court claim can be marked `resolved` after it has reached every living villager and a majority of living villagers deny it. Resolution removes its links to related claims so it no longer reinforces them. A targeted accusation that qualifies for court is handled by the court first.

### Resolution court trigger

A resolution court convenes when all of the following are true:

1. A non-resolved rumour names an identifiable living villager.
2. That individual claim has reached every living villager, **or** a qualified authority who knows the claim holds a believer stance with at least 90% confidence and compels a hearing.
3. At least two villagers remain alive.
4. No other court is currently active and the related case has not already received a court session.

Verification status, credibility, belief level, believer count, personal court preference, and vigilante preference do not affect this trigger.

The authority override is based on that authority's personal certainty rather than the claim's global verification label. The Sheriff has town-wide authority; medical authorities also qualify for attack, assault, injury, damage, and other health-related incidents. When an authority compels a court before organic propagation finishes, the claim is formally delivered to every uninformed living villager as part of convening the session.

Related unresolved accusations naming the same defendant are grouped into the case, even though one fully propagated claim is sufficient to convene it.

### Court procedure

1. All living villagers end conversations and travel to the town square or a walkable fallback location.
2. The accused and every eligible voter stop moving once gathered or when the gathering deadline expires.
3. The accused gives a substantive defense addressing all related claims.
4. Every other living villager gives a public statement and votes.
5. Court LLM requests make one initial attempt and retry at least three times, for four total attempts. Responses accept clean JSON, fenced JSON, or JSON wrapped in short prose. Only after all four attempts fail does that individual defense or vote use a deterministic fallback; later villagers still receive independent LLM requests.
6. A majority verdict is calculated.
7. Before release, removal, or execution is applied, the accused hears the outcome and gives a public outcome-specific statement. This statement also receives four LLM attempts and an outcome-aware fallback.
8. Every living participant records a post-verdict statement based on the outcome, their own vote, and their original reasoning. The accused's outcome response serves as their statement; voters explicitly say whether the result aligned with their vote.
9. The verdict and statements are recorded in village memory, then the resolution is applied.
10. After the user acknowledges the main verdict dialog, a separate Village Post-Verdict Statements popup presents every participant's response, including agents subsequently exiled or executed.
11. Every remaining villager receives a post-court reaction prompt encouraging them to discuss the verdict, fairness, evidence, and consequences with someone nearby. They may agree or disagree according to their own memories, beliefs, relationships, and vote.
12. Remaining villagers disperse and resume their schedules around these post-verdict conversations.

### Possible court votes

- `absolve`
- `exile`
- `execute`

### Possible village court resolutions

- **Absolved**: execute votes do not reach a majority and combined execute-plus-exile votes do not reach a majority. The accused remains in the village.
- **Exiled**: execute votes alone do not reach a majority, but combined execute-plus-exile votes do. The accused is removed from the simulation and village schedules.
- Exiled villagers remain persisted in the Agent States debug interface with a distinct `EXILED` status, exile time, court reason, memories, and complete details. They are inactive and excluded from living-agent behavior and world rendering rather than being deleted like transient data.
- **Executed**: execute votes reach a majority. The accused takes lethal court damage and dies.
- **Court dissolved / procedural absolution**: if the accused is no longer present or the court location cannot be resolved, the proceeding ends without punishment.

Execution is deliberately presented to the LLM as irreversible and appropriate only for exceptionally grave, credible threats. Both LLM and fallback votes are required to remain consistent with personal stance. Fallback believers vote for exile even when their believed claim is still unverified; aggressive, highly confident believers may vote for execution only when a grave claim is verified. Deniers and villagers with no believed claim vote to absolve.

This consistency check now also applies uniformly after any non-cultist voter's LLM vote, not only the deterministic fallback. A voter who does not actually hold a believer stance on any claim in the case is forced to `absolve` regardless of what they voted. A voter who chose `execute` is downgraded to `exile` unless they believe a genuinely court-eligible claim with at least 85% confidence -- an execute vote otherwise reads as firmer conviction than the voter actually holds. Cult members are unaffected by this check; they continue to follow their bloc's directed vote instead.

## Social interfaces

- **Rumour & Belief Tracker**: shows claims, origins, credibility, reach, related branches, objective whisper truth controls, agent judgments, individual belief badges, and private thought events.
- **Role markers**: Agent States rows and the complete agent-details popup mark Prophets with `✦`, Knight outsiders with `🛡`, Inquisitor outsiders with `⚖`, and user-commanded Demons with `☠`; details expand each icon into a labeled badge.
- **Court Readiness**: groups cases by accused, shows full-village reach, related statuses, and every living villager's stance for each claim. Belief is informational rather than a readiness gate.
- **Resolution Court panel**: shows the accused, grouped accusations, defense, statements, votes, progress, and final verdict.
- **Debug agent panel**: shows current activity, LLM request state, needs, emotion, reputation, relationships, memory, and other internal state.
- **Agent details popup**: the Details button beside every agent name opens a live, scrollable view of the complete state, needs, inventory, personality scores and behavioral meanings, worldview, deity beliefs, cult membership, current reasoning and active block, remaining daily schedule, queued intentions, relationships, fears, grudges, alliances, memory summary, and recent memories.
- **Cults & Groups tracker**: a collapsible panel at the lower right beside the debug panel lists every cult, founder, membership count and member names, plus connected alliance groups. Founder names open the complete agent-details popup.
- Clicking a cult entry opens a live cult-details popup with leader and membership data, collective aggression and mob readiness, each member's current state and cult-related requests or intentions, and every outsider's conversion progress or worldview immunity.
- Cult membership records the simulated join time, whether the member founded the cult, accepted an invitation, or converted through preaching, and the recruiter responsible. The cult-details popup shows this provenance as soon as the member joins; older saved memberships are labelled as legacy membership.
- **Conversation panel**: shows active exchanges between villagers.
- **Event history**: records causation, observers, outcomes, and world-state changes for social actions and resolutions.

## Political system

Every villager has a `wealth` score from 0 to 100, seeded at creation with a
mild bias toward commerce-facing trades (Merchant, Steward, Innkeeper skew
wealthier; Farmer and Carpenter skew more modest). After the initial village
is generated, villagers are ranked by wealth and split at the median into two
political camps of as-equal-as-possible size: the wealthier half forms **The
Gentry**, the poorer half forms **The Commons**. Camp membership is recorded
directly on each villager's state, the same way cult and anti-cult membership
are recorded, and a villager's camp persists across saved games; a restored
save backfills camp membership for any agent that predates this system using
the same wealth-ranked split.

### Policy votes

The village periodically convenes a policy vote using the resolution court's
gathering and sequential-statement-and-vote machinery, but for a town-wide
policy question instead of a personal accusation. There is no defendant and
no defense phase. A vote is convened by the Steward when present, or
otherwise the living villager with the highest reputation, from a small
catalog of proposals (grow more crops, expand trade, strengthen the guard,
fund the apothecary, commission construction), each tied to a beneficiary job
and a wealth reward. A resolution court and a policy vote cannot be active at
the same time; each preempts the other from starting.

1. Every living villager travels to the town square.
2. Once gathered (or a gathering deadline passes), each living villager
   speaks and votes `support` or `oppose` in turn. The vote is influenced by
   the villager's own job (self-interest when the proposal targets their own
   trade), political camp, and personality; camp-mates' earlier votes in the
   same session are shown to later voters as social context, though camp
   voting is not a mandatory bloc the way cult voting is.
3. A simple majority of `support` votes passes the proposal.
4. If passed, every living villager working the proposal's target job gains
   wealth (for example, a passed "grow more crops" proposal raises every
   living Farmer's wealth). A rejected proposal has no mechanical effect.
   Every wealth policy spends the village's own funds, so the Gentry camp
   leans against supporting one by default regardless of which trade
   benefits; a Gentry voter's remaining path to support is direct
   self-interest, when the proposal targets their own trade.

The **Village Assembly** panel shows the live question, gathering/voting
status, each villager's statement and vote, and the final outcome, mirroring
the Resolution Court panel's presentation.

### Political and cult votes

Beyond routine economic policy, the assembly can convene over the town's
relationship to cults and the outsiders investigating them. Two additional
questions become eligible independently of the economic catalog, and when
either is eligible the next assembly has a 60% chance to take up a political
question instead of an economic one:

- **Outlaw a cult**: eligible once a Priest or Inquisitor investigation has
  verified a cult-related rumour, the same verification the court system
  relies on to treat a cult as proven rather than merely suspected. If the
  proposal passes, every living member of that cult is immediately stripped
  of membership, exactly as with a voluntary defection, but without the
  resulting enmity toward the former cult.
- **Outlaw the Knight or Inquisitor**: eligible only while a living member of
  a political camp is also a living cult member, giving a faction a motive to
  remove whichever outsider might expose them. If the proposal passes, that
  outsider is banished from the village using the same removal used for a
  court exile. The targeted outsider does not vote on their own banishment.

Votes on these questions are influenced the same way as economic votes, plus
an explicit self-interest signal: a cult member is heavily biased toward
opposing a vote to outlaw their own cult, and any cult member is biased
toward outlawing a Knight or Inquisitor who could expose them.

When a political question is selected, its mechanical outcome is always
determined by the deterministic proposal text and effect described above;
the LLM is occasionally asked afterward to narrate the assembly's exact
wording, grounded strictly in those same facts, and the default wording
remains in place if that narration is skipped or fails.

### The office of Alderman

A living cult leader or founder may propose themselves for the office of
Village Alderman using the same assembly machinery as other political
questions, convening the vote personally rather than through the Steward or
highest-reputation villager. Unlike every other proposal, this one requires
true unanimity: every single living villager must vote to support it, and one
opposing vote defeats it. A villager who belongs to the proposing leader's
own cult always votes to support their leader's bid; every villager outside
that cult always votes against handing anyone that kind of unchecked power,
regardless of what an underlying LLM vote would otherwise produce. In
practice this makes the office achievable only once the leader's cult has
converted every living villager in the town — there is no other path to a
unanimous vote. Only one living Alderman may hold office at a time, and the
office is not proposed again while one is seated.

Once seated, the Alderman's own vote is binding rather than one ballot among
many. In a resolution court where the Alderman is an eligible voter (not the
accused), the case is decided by the Alderman's vote directly instead of by
majority: whatever the Alderman votes — absolve, exile, or execute — becomes
the verdict outright, and the resolution names it as a decree. In every later
village assembly, the Alderman's own support or oppose vote likewise decides
the question outright instead of being tallied toward a majority. The
existing rule that no cult member may vote to execute a fellow member of
their own cult still applies to the Alderman's vote, so an Alderman can never
personally condemn a fellow cultist to execution — only exile. The office
ends only if the Alderman dies or is removed from the village; it is not
automatically inherited by a cult successor.

A successful, unanimous election is chronicled as its own Story Narration
moment (`alderman_named`) — a village assembly unknowingly handing binding
authority to one of its own hidden cult leaders.

## Configuration affecting social dynamics

- `agentCount`: village population.
- `conversationChanceMultiplier`: chance of greeting unfamiliar villagers.
- `rumourPropagationMultiplier`: rumour-driven encounter and sharing probability; also scales mutation probability.
- `inventedRumourProbability`: chance of creating an organic suspicion when eligible.
- `rumourExtremeBeliefProbability`: chance of fixed full belief or denial on first exposure.
- `memoryBufferSize`: recent social events kept directly in memory.

A freshly generated village that includes a Priest does not start entirely irreligious: that Priest founds "The Church of Christ" at generation, already leading a small established congregation of two or three other villagers (excluding whichever villager was assigned as the village's initial atheist). The Priest and these founding members start as committed believers in Christ specifically, with elevated faith — distinct from the generic "God" deity name, which remains free for players to reassign to a cult of their own choosing (Cthulhu, Dagon, or anything else) without colliding with the starting congregation's belief. This only applies to a brand-new village; loading an existing save never re-seeds or alters its cult state.

This specific congregation cannot win over an "unaligned believer": a villager whose worldview is already `believer` — of any deity, not only a rival one — is immune to its preaching and direct invitations, and any conversion progress already accrued toward it is cleared the moment a villager becomes a committed believer elsewhere. Only the genuinely undecided remain convertible. This immunity is specific to the seeded Christian congregation; a cult a Prophet founds is not restricted this way and can still win over an already-devout believer.

The relationship is one-directional. Ordinary cult membership is otherwise exclusive — a villager already in a cult cannot be preached to or invited by a different one — but a member of the Christian congregation specifically remains poachable by any other cult, even though the Christian congregation itself can never poach in return, from anyone. A poached member simply converts: their prior membership is recorded under their former cults with no enmity, grudge, or anti-cult-group consequence, unlike a voluntary defection.

## Cult recruitment

The Prophet role replaces secular employment rather than coexisting with it. Once appointed, a Prophet's generated plans, saved schedule, active blocks, and fallback activity are prevented from returning to generic `work`. Former working hours become prayer when no cult exists, or preaching and religious organization when the Prophet leads a cult. Productive plans must serve revelation interpretation, cult formation and recruitment, prayer, preaching, rites, conjuring, summoning, healing, blessing, cursing, resurrection, or investigation and travel explicitly connected to divine duties. Essential eating, sleeping, rest, safety, and emergency responses remain available.

A cult leader can choose the `invite_cult` action with an unaffiliated living villager as the target. The leader travels into conversational range and makes the invitation personally; if the target moves away, the leader continues approaching rather than recruiting remotely. Acceptance is not automatic. It is influenced by the leader's friendliness and faith, the relationship between both villagers, and the invitee's curiosity and caution. Acceptance adds the invitee as a cult member, while rejection leaves them unaffiliated. Both results are recorded in the participants' memories and event history. Ordinary cult members cannot issue membership invitations.

Every path into becoming a believer or cult member — direct invitation, accumulated preaching progress, an undecided listener spontaneously resolving their worldview, or willingly seeking out a leader after a divine conversation — also seeds a named deity belief for the new believer, keyed to whichever deity their leader/preacher is understood to worship (the same name-resolution logic Deity abilities use). A first-time convert starts at 50% confidence; an existing belief in that same deity is instead raised to at least 50%. Without this, a newly converted villager would carry an empty deity-beliefs list forever despite being a committed member of a cult devoted to a specific god.

Nearby unaffiliated believers and undecided villagers accumulate persistent, per-cult conversion progress whenever they listen to preaching. Repeated sermons eventually convert them into members. Established nonbelievers and atheists never gain preaching progress and always refuse direct cult invitations.

Conversion immunity applies to every social conversion pathway. Nonbelievers and atheists cannot be converted by ordinary faith appeals, cannot receive automatically inserted conversion dialogue, cannot accumulate cult-conversion progress, and cannot accept cult recruitment. Any stale progress on an immune agent is cleared during simulation updates. Undecided villagers remain eligible to choose a worldview.

Religious compatibility increases susceptibility. When a cult leader has at least 50% confidence in a deity and a prospective convert has at least 60% confidence in the same or a similarly named deity, the convert's deity confidence provides a substantial bonus to both preaching progress and direct-invitation acceptance. This affinity never overrides nonbeliever or atheist immunity.

Political difference resists conversion. When the preacher or inviting leader and the prospective convert belong to opposing political camps (Gentry vs. Commons), both preaching progress and direct-invitation acceptance take a flat penalty, making a member of the opposing faction harder, though never impossible, to convert. Sharing a camp, or either party having no camp, carries no penalty.

Blessing grants its recipient a persisted 1.5× ability multiplier for six simulated hours in addition to its immediate confidence and reputation effects. A blessed cult leader applies that multiplier to preaching progress and direct recruitment influence; expired blessings are cleared when their multiplier is next consulted.

The conversion portion of a cult leader's blessing never affects nonbelievers or atheists. Their immunity is checked before recruitment and preaching calculations and again when resolving the blessing multiplier, so the leader receives only the neutral 1× conversion value against an immune target and no progress or acceptance roll occurs.

The Agent States panel and complete agent-details popup display every active blessing's multiplier, affected abilities, source, and remaining simulated duration. Expired effects disappear from the display.

An undecided listener who has reached meaningful conversion progress—or already has strong affinity with the cult leader's deity—may resolve their worldview while hearing a sermon. Their accumulated progress, deity affinity, curiosity, caution, and the leader's friendliness determine whether they become a believer or a nonbeliever. Becoming a nonbeliever clears that cult's progress and makes them immune to later recruitment; joining a cult establishes a believer worldview and viable minimum faith.

A cult becomes extinct when it has no living members. If its sole member dies—or every member of a larger cult dies—the cult affiliation is removed from those deceased agents and the cult disappears from the Cults & Groups tracker. A cult with at least one surviving member is retained.

The leader of any non-Christian cult has a second recruitment path, `bribe`, aimed specifically at the population `invite_cult` and `preach` can never win over: an unaffiliated villager who has revealed themselves as a nonbeliever or atheist. The leader travels into range and offers a sum of their own wealth. Susceptibility rises as the target's own wealth falls — a poorer villager is easier to buy — and is further shaped by the size of the offer, the pair's existing relationship, the leader's ambition, the target's caution, and opposing political camps. A villager who lacks enough wealth to make a worthwhile offer cannot attempt the bribe. Success transfers the offered wealth from leader to target and adds the target to the cult as an "associate" rather than a genuine member; nothing about their worldview or faith changes. A refusal costs the leader nothing.

An associate's membership exists only to be spent on one village assembly vote. While bribed, the associate does not deliberate: their vote is dictated entirely by the bribing cult's interest — opposing any motion to outlaw their own cult, supporting one against a rival, backing their own cult leader's bid for Alderman and opposing anyone else's, and otherwise falling in line with whatever keeps the cult's activities unexposed. The instant that vote is cast, the associate's cult membership lapses and they return to being unaffiliated, free to be bribed again in some later vote.

Cult leadership is automatically reconciled whenever a leader dies or is exiled. A living fellow cult member who personally kills the leader becomes the preferred successor immediately. For exile, a living cult member whose court vote supported exile or execution is preferred. If no directly responsible member is eligible, the most ambitious living member succeeds. The former leader retains membership history but loses the leader role, the successor develops fresh personality-driven agendas, and the succession reason is recorded as a witnessed cult-leadership event.

## Deity intervention controls

The Simulation Controls panel contains invocation-gated Deity abilities: Bless, Heal, Smite, Resurrect, and Manifest. They remain disabled until a completed cult rite or prayer/preaching by a committed believer in any deity held with meaningful confidence produces an invocation credit — worship is not limited to God specifically; a believer devoted to Dagon, Cthulhu, or any other named deity qualifies just the same. The panel displays the action that enabled intervention, and every successful use consumes one credit. Invalid uses, such as trying to resurrect a living target, do not consume a credit. Credits and their latest source persist in saved games, and intervention is recorded as a witnessed consequence of worship rather than arbitrary direct manipulation.

Resurrection (by a Deity ability or a cult's own rite) reopens a death that other villagers already witnessed, and the shock of it can break minds a second time. Every non-cult witness of the villager's original death goes through the existential reaction system described above (see "Existential reactions to forbidden knowledge") and may enter permanent insanity as its madness outcome. If the deceased had instead been executed on a resolution court's verdict and a Deity ability is the one reversing that sentence, every living villager who voted to execute them additionally goes through the same reaction over the guilt of a now-undone judgment, independent of cult membership. Both skip anyone already permanently insane, and a successful resurrection clears the recorded death and its witnesses regardless of outcome.

Which deity is named in the ability's outcome depends on context rather than always defaulting to the same name. A targeted Manifest names whichever deity the target themselves worships most strongly (their own highest-confidence deity belief) — manifesting to a Priest whose flock reveres Dagon reads as Dagon manifesting, not God. An untargeted Manifest, and every other ability, names whichever deity most recently earned the invocation credit being spent, falling back to "God" only when no specific deity is known.

Simulation Controls also provides **Refresh Agents**, a non-destructive repair
operation. It invalidates outstanding LLM results, clears schedules, paths,
conversations, active blocks, queued intentions, encounters, court gathering,
and transient group targets. Living agents are placed on distinct walkable
tiles and begin generating fresh plans. Identities, health, beliefs,
relationships, cult state, memories, rumours, buildings, resources, deaths,
exiles, and historical events remain intact; the refresh itself is logged.

Change Weather is also available as an invocation-gated Deity ability. The user selects clear, cloudy, rain, or storm conditions; a successful intervention applies suitable temperature and hazard state immediately, delays the next natural weather transition for three simulated hours, records the divine intervention for every living villager, and consumes one invocation credit.

Create Relic is another invocation-gated Deity ability. The user can type a custom text statement and specify or type a custom deity name. Once confirmed, the interface enters a map-based placement mode (indicated by a crosshair cursor and a red visual tile preview on the game canvas). Clicking a tile places down a permanent `ForbiddenRelic` at that position, consuming one invocation credit. Unbelievers of the associated deity who stumble near it will read the text, gain the knowledge as a `forbiddenKnowledge` memory, and have an immediate 80% chance of going permanently insane (triggering the `'madness'` reaction). Believers of the associated deity ignore it.


## Dreamscape: planted and spontaneous nightmares

Dream is the quietest invocation-gated Deity ability, distinct from the overt Bless/Smite/Manifest family: rather than acting on a villager while they're awake, it reaches into the mind of a villager who is currently asleep (`activeBlocks` shows a `sleep` action with `sleepStartedAt` already set) and plants a short piece of free-text content as a dream. Only cult-unaligned villagers can be targeted — anyone with a `cult` affiliation is treated as already shielded, the same immunity language used for The Church of Christ elsewhere in the religion systems. Selecting the ability costs one invocation credit like any other.

Whether the planted content lands as an ordinary dream or curdles into a nightmare is a roll weighted against the target's current sanity: the frailer their sanity already is, the likelier it turns into a nightmare. A nightmare additionally drains 5-15 more sanity on the spot and sets the target's emotional state to afraid; an ordinary dream leaves sanity untouched. Either way the content is recorded as a private memory, colors the target's own internal reasoning the next time they act, and is surfaced explicitly to the conversation system — a dreaming villager is nudged to bring the dream up unprompted with whoever they next talk to, discussing it more insistently and fearfully if it turned into a nightmare.

Independent of any player action, cult-unaligned villagers can also have a nightmare arise on their own the instant they fall asleep. The odds scale with a 0-1 "town corruption level" — a blend of the ambient environmental corruption tracked by `EnvironmentSystem` (ambient tile corruption from nearby shrines, demons, and summoning rites) and the fraction of the living population that currently belongs to a cult — combined with the same sanity weighting used for planted nightmares, capped at a 15% chance per sleep. A spontaneous nightmare draws from a small pool of Lovecraftian flavor lines (something vast stirring underground, neighbors' faces going wrong, a voice chanting words that hurt to remember, and similar), drains a smaller 3-10 sanity, and is otherwise indistinguishable from a player-planted one once it lands — same fear response, same private memory, same pressure to surface it in the next conversation. In effect, the more corrupted and cult-ridden the town becomes, the more its ordinary, unaffiliated residents start losing sleep over things they can't explain.

Either kind of dream is temporary: it persists through the villager's following waking hours (and is visible in the Agent States detail popup, tagged by source — "player" or "spontaneous") but is cleared automatically the next time that villager falls asleep again, whether or not a new one replaces it.

Believers include an explicit `pray` block in each remaining daily schedule. The planning prompt requests it naturally, and schedule validation repairs an omitted prayer by splitting a suitable work, rest, talk, or idle block without creating an overlap; if necessary it appends a short prayer before the end of the day. Prayer is available to believers outside cults as well as cult members, and worship directed toward any deity held with meaningful confidence — not only God — qualifies for a deity-intervention credit.

## Forbidden Relics

Forbidden Relics are physical objects left behind in the world that act as permanent, map-visible hazards. When an agent discovers and reads a relic, it can impact their sanity, introduce forbidden knowledge, or sway them to join a cult. Relics are rendered on the map as diamond markers and are fully persisted through world saves/loads.

### Creation Paths

Forbidden Relics can be generated in two ways:

1. **Organic Investigation Writing (16% Chance)**:
   - When a vocation-based investigation concludes (whether verified or unsubstantiated), the investigator has a flat 16% chance (`RELIC_CREATION_CHANCE`) to pen their findings into a physical relic.
   - A separate roll decides if the relic's text contains forbidden knowledge. The base chance is 35%, which increases by 30% if the author already carries forbidden knowledge, and by 15% if the rumour text is cult-related (referencing cults, rituals, heretics, demons, deities, etc.), capped at 85%.
   - If it contains forbidden knowledge, the author immediately faces an existential-witness sanity check (risk of nihilism, obsession, or permanent insanity).
   - If the author belongs to a cult, the relic is tagged with their cult's ID, cult name, and deity.

2. **Deity Command (Create Forbidden Relic)**:
   - The player can invoke the **Create Relic** deity ability at the cost of one invocation credit.
   - The user inputs custom revelation text and specifies an associated deity.
   - The simulation enters a map placement mode where the player clicks a grid tile to place the relic.
   - Deity relics have a fixed severity of 90, are marked as containing forbidden knowledge, and are authored by `'deity'` (Divine Manifestation).
   - Creation is chronicled through its own `deity_relic_created` Story Narration moment, distinct from `forbidden_relic_created` (which is reserved for a mortal investigator's own written findings).

### Discovery and Interaction

* **Periodic Watchdog**: The `RelicSystem.advanceRelics()` loop ticks once per simulated minute.
* **Proximity Trigger**: If any living agent wanders within a 2.5-tile discovery radius (`DISCOVERY_RADIUS`) of a relic, they read its contents.
* **Target Filter**: An agent is only affected if they are not the relic's author and they are either not in the relic's cult, or they belong to an opposed group.
* **One-time Read**: Each agent can only discover and read a specific relic once (`discoveredByAgentIds`).
* **Consequences**:
  - **Deity Relics**: If the discovering agent already believes in the associated deity (confidence >= 50%), they are unaffected. Otherwise, they acquire the text as forbidden knowledge and face an immediate **80% chance of permanent insanity** (`'madness'` reaction) -- unless they are a cultist (secret prophet, leader, or ordinary member), whose conviction shields them from the roll entirely, the same exemption applied to forbidden-knowledge rumours. If they pass the 80% sanity check (or are shielded), they resolve the knowledge via normal existential-witness reactions.
  - **Organic Relics with Forbidden Knowledge**: The agent undergoes a standard existential-witness reaction check.
  - **Cult Alignment**: If the relic is cult-tagged, the agent has a personality-weighted chance (scaled by curiosity and caution) to willingly join the associated cult. Specifically, the base chance is 35% if the relic is forbidden (20% if not), boosted by `curiosity * 0.25` and penalized by `caution * 0.2`. If they pass, they trigger `maybeTriggerWillingCultJoin` toward the deity.

## Cult schemes: covert, job-flavored conversion

Beyond ordinary preaching, invitation, and bribery, a cult leader (or founder) has one additional, quieter recruitment channel: once per simulated day, they may devise a covert **scheme** that uses their own public trade as cover — a farmer's tainted grain, a carpenter's idol worked into an ordinary carving, a merchant's marked trinket, a priest's consecrated relic — without any of it visibly reading as cult activity to onlookers.

An LLM is asked to invent the scheme's flavor, but it is deliberately given only two choices with any mechanical weight: which kind of tactic to use, and how bold a posture to take. Everything about how *powerful* the scheme actually is comes from the leader's own standing in the village — their ambition, their faith, the size of their cult, and their reputation — not from anything the LLM decides. A leader with little real influence who asks for something bold gets no more out of it than their circumstances actually support; a well-established, ambitious leader playing it "subtle" is deliberately holding back rather than being mechanically weak.

### The two tactics

- **A planted object** (idol, charm, marked trinket, tainted batch, consecrated token) — placed near a building of the leader's own trade, where an unsuspecting villager may later stumble on it. This becomes an ordinary Forbidden Relic (see above), so it is discovered, read, and reacted to through the exact same proximity mechanic as any relic left behind by an investigator's own writing — no separate discovery system exists for it. Depending on how potent the leader's own standing makes the scheme, the object may carry nothing more than a quiet pull toward the cult, or it may cross into genuine forbidden knowledge with the same sanity risk a written relic poses. A merchant's trinket can never carry that risk regardless of potency — some vocations simply aren't plausible carriers of real lore, however bold the merchant is willing to be.
- **Quiet influence** — using ordinary daily contact near the leader's own workplace (customers at a stall, patients at the apothecary, a congregation at the pulpit) to nudge nearby villagers a little further toward the cult, with nothing physical left behind. This uses the same underlying conversion-progress mechanic as ordinary preaching, just scaled by the scheme's computed potency rather than a flat rate.

Every vocation affords quiet influence. A planted object is only available to trades with a plausible physical craft or private access — farmer, carpenter, merchant, blacksmith, healer, steward, innkeeper, and priest — each tuned to how severe and lore-bearing an object that trade could credibly produce (a blessed relic from a priest can carry real forbidden knowledge; a peddled trinket from a merchant never can). The Town Guard has no natural object to plant, but their authority gives them unusually strong quiet-influence leverage instead — villagers cannot as easily decline a guard's attention the way they could a stranger's.

### Guardrails

An LLM's proposed scheme is checked against what the leader's actual trade affords before anything happens: a proposal asking for a tactic the leader's vocation doesn't support is rejected outright, not weakened or reinterpreted. A rejection prompts one retry with the specific reason folded back into the request; if that also fails, a small, deliberately unremarkable fallback scheme for that trade is used instead, so a struggling local model never blocks a leader's turn entirely. Nothing about the fallback path is mechanically weaker than an LLM-authored scheme — only its flavor text is blander.

### Discovery

A scheme that plants a relic gets caught the same way any relic does: a villager who wanders close enough reads it, and depending on what it actually contains, that can end in nothing more than a quiet nudge toward the cult, or in the same sanity risk (and eventual investigation trail) that any other forbidden writing poses. Nothing about a scheme-planted relic is hidden from the systems that already watch for this — investigators, priests, and the Sheriff treat it exactly like an ordinary relic once it's found.

## Village endings

Two long-run outcomes are checked every tick against the current set of living villagers, each narrated only once per game:

- **The Village That Remains**: every living villager currently belongs to a cult, with no unconverted soul left in the village. If the sole survivor happens to be that cult's own leader or founder, the moment narrates instead as that leader's hollow, solitary triumph ("Alone With The Faith") rather than the more general village-wide beat.
- **The Last Cult Falls**: after at least one cult has existed at some point in the game, every cult (and every leader who ever led one) is gone — to death, exile, or plain abandonment — leaving no altar tended and no congregation left anywhere in the village. This never fires for a fresh village that never had a cult in the first place.

Both checks re-derive the village's current composition from the living-agent list rather than hooking into any specific death, exile, or defection event, since a villager can stop being alive or stop belonging to a cult through many different paths.
