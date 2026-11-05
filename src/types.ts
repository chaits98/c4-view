/**
 * FROZEN CONTRACT. Every stage of the renderer speaks exactly these types.
 *
 * Nothing in this file may be edited to make a parallel workstream possible:
 * a shape change is landed once, by the orchestrator, before dispatch.
 *
 * Pipeline:  Model --model.parse--> LevelSpec --rank--> Ranked --order--> Ranked
 *            --place--> Placed --route--> Routed --emit--> svg   (+ audit)
 */

// ── the C4 taxonomy, as the C4 model defines it ─────────────────────────────

export type C4Level = 'context' | 'container' | 'component' | 'code'

export type Subtype =
  // context
  | 'system' | 'person' | 'role' | 'external-system' | 'boundary'
  // container
  | 'web-application' | 'microservice' | 'database' | 'cache' | 'message-queue'
  | 'file-storage' | 'search-engine' | 'load-balancer' | 'cdn' | 'serverless-function'
  | 'batch-job' | 'container-registry' | 'dns' | 'api-gateway'
  // component
  | 'ui-component' | 'api-controller' | 'service-logic' | 'repository' | 'middleware'
  | 'plugin' | 'module' | 'event-handler' | 'job' | 'adapter' | 'saga' | 'workflow'
  | 'library' | 'config' | 'migration' | 'test-suite'
  // code
  | 'class' | 'interface' | 'abstract-class' | 'function' | 'enum' | 'type-alias'
  | 'c4-module' | 'schema' | 'dto' | 'constant' | 'test-file' | 'migration-file'
  | 'config-file' | 'script'

/** The four states a box can be in. Closed on purpose: a free-text status becomes a comment field. */
export type NodeState = 'built' | 'planned' | 'partial' | 'retired'

/** Visual family — decides the shape and the colour token. */
export type Kind = 'concept' | 'step' | 'tool' | 'fact'

export type EdgeStyle = 'flow' | 'dep' | 'tent' | 'dir'

// ── input model ──────────────────────────────────────────────────────────────

export interface NodeSpec {
  id: string
  label: string
  subtype: Subtype
  /** second line: technology / responsibility */
  tech?: string
  /** hover text */
  desc?: string
  /** stable human id rendered as the label's first line, e.g. DRD-D1 */
  identity?: string
  /** absolute rank hint (column index); wins over the computed rank */
  rank?: number
  /** boundary group id this node belongs to (see LevelSpec.groups) */
  group?: string
  /** laid-out size, set by the nested renderer so a host box can hold the picture drawn inside it */
  w?: number
  h?: number
  /** the size the author ASKS for; a floor, never a replacement — many incoming edges need the width */
  size?: { w?: number; h?: number }
  /** external documentation for this box (a wiki page, a runbook). http/https only; drawn as a chip. */
  links?: { label: string; href: string }[]
  /** how real this box is. Absent means 'built'; anything else is drawn as a corner tag AND fails the
   *  audit, so a picture of a roadmap can never be mistaken for a picture of the system. */
  state?: NodeState
  /** outline override; a host box holding a child picture is always a plain rectangle */
  shape?: string
}

export interface EdgeSpec {
  from: string
  to: string
  label?: string
  /**
   * One sentence on what crosses this edge: shown on hover and under the flow caption.
   * `parseModel` refuses a model where it is missing, so every model that reached this type has one; the
   * field is optional here because a hand-built fixture (a layout test, a probe) has nothing to say.
   */
  desc?: string
  /** default 'flow' */
  style?: EdgeStyle
}

export interface GroupSpec {
  id: string
  label: string
  /** node ids; the boundary box is their bounding box plus padding */
  members: string[]
}

export interface LevelSpec {
  /** true on the picture the full view builds: every level open, frames inside frames */
  nested?: boolean
  /** drill path: '' for root, 'app' for a child of node `app`, 'app/db' below that */
  path: string
  title?: string
  nodes: NodeSpec[]
  edges: EdgeSpec[]
  /** C4 boundaries; drawn behind the graph, may be crossed by external edges */
  groups?: GroupSpec[]
  /**
   * The linear order a viewer animates, as edge keys `"from->to"` — the true data
   * flow only the author knows. Absent, the order is derived (flowOrder): depth
   * first from the source nodes. Every edge animates exactly once, one at a time.
   */
  flow?: string[]
  /**
   * Ports make this level a LENS: the inside of one box, not another drawing.
   *
   * Key = an edge in the PARENT level that touches the host node (`"client->api"`);
   * value = the node in THIS level that edge now lands on (`"router"`). The expanded
   * view keeps the parent's other boxes and re-attaches its edges through these
   * ports, so nothing outside the box disappears when you look inside it.
   *
   * Absent: the level renders standalone, and drilling into it loses the outside.
   */
  ports?: Record<string, string>
}

export interface LayoutConfig {
  /** 'auto' keeps C4's left-to-right unless the drawing is a strip; 'LR' and 'TB' are the user's choice */
  direction: 'auto' | 'LR' | 'TB'
  /** space between adjacent ranks (columns for LR) */
  rankGap: number
  /** vertical space between nodes inside one rank */
  nodeGap: number
  /** one routing track's thickness — every jog in a gutter owns a distinct track */
  lane: number
  /** minimum distance between two ports on the same node side */
  portGap: number
  /** label wrap width in characters (also caps box width in glyphs) */
  labelMaxChars: number
  fontSize: number
  nodePadX: number
  nodePadY: number
  minW: number
  maxW: number
}

export interface Model {
  id: string
  title: string
  layout?: Partial<LayoutConfig>
  levels: LevelSpec[]
}

// ── measurement (injected: the layout never touches a font API) ──────────────

export interface Measure {
  /** advance width of a single line at `size` px */
  width(text: string, size: number): number
  /** greedy word wrap; never returns an empty array (empty input -> ['']) */
  wrap(text: string, maxWidth: number, size: number): string[]
}

// ── geometry ─────────────────────────────────────────────────────────────────

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }
export type Side = 'l' | 'r' | 't' | 'b'

/** One item in a rank: a real node, or a dummy that reserves corridor space. */
export interface RankItem {
  /** node id, or `d:<edgeKey>:<rank>` for a dummy */
  id: string
  rank: number
  /** position within the rank after ordering */
  index: number
  w: number
  h: number
  dummy: boolean
}

/** One edge expanded into the item chain it passes through. */
export interface Chain {
  /** `${from}->${to}` */
  key: string
  from: string
  to: string
  /** [from, ...dummies, to] in rank order */
  items: string[]
  label?: string
  style: EdgeStyle
  /** rank[from] > rank[to]: routed through the bottom return corridor */
  backward: boolean
}

export interface Ranked {
  /** item ids per rank, in order */
  ranks: string[][]
  items: Map<string, RankItem>
  chains: Chain[]
}

export interface PlacedItem extends RankItem { x: number; y: number }

export interface Placed {
  items: Map<string, PlacedItem>
  chains: Chain[]
  /** real nodes only */
  boxes: Map<string, Box>
  groups: Array<{ id: string; label: string; box: Box }>
  size: { w: number; h: number }
}

export interface RouteLabel { text: string; box: Box }

export interface Route {
  key: string
  pts: Point[]
  label?: RouteLabel
}

export interface Routed {
  routes: Route[]
  size: { w: number; h: number }
}

// ── audit ────────────────────────────────────────────────────────────────────

/** How many wires cross per edge: the author's target, not just the gate's threshold. */
export type DensityVerdict = 'crisp' | 'ok' | 'dense' | 'over'

export interface AuditReport {
  /** nodes that declare a state other than built (`id:state`) — a non-empty list fails the page */
  unbuilt?: string[]
  /** nodes that declare NO state — drawn as built, refused by the audit */
  unstated?: string[]
  /** true when this report is of a drilled picture (parent level with one box expanded) */
  composed?: boolean
  /** true when the picture is too tangled to follow: more than two wire crossings per edge */
  dense?: boolean
  level: string
  nodes: number
  edges: number
  /** node ∩ node (area > 0) */
  nodeNode: number
  /** a route passing through a node box that is not one of its own ends */
  wireNode: number
  /** two routes sharing a collinear segment longer than 2px */
  wireWire: number
  /** proper orthogonal crossings — unavoidable, minimised, reported */
  crossings: number
  /** crossings per edge, rounded to two places: the author's target number */
  crossingsPerEdge: number
  /** crisp (≤0.5/edge) · ok (≤1) · dense (≤2) · over (the gate) */
  verdict: DensityVerdict
  /** edges the ranking draws right-to-left; usually a `rank` hint that collides with an edge. Reported, never gated. */
  backward: number
  /** label chip ∩ label chip */
  chipChip: number
  /** label chip ∩ node */
  chipNode: number
  /** a boundary box covering a node that is NOT one of its members. Gated: only the model's
   *  membership or a level split fixes it, and a picture that hides that is lying */
  groupNode: number
  /** every gate at zero */
  ok: boolean
  /** width / height of the drawing */
  aspect: number
}

export const SUBTYPE_KIND: Readonly<Record<Subtype, Kind>> = {
  'system': 'concept', 'person': 'concept', 'role': 'concept',
  'external-system': 'tool', 'boundary': 'tool',
  'web-application': 'tool', 'microservice': 'tool', 'database': 'tool', 'cache': 'tool',
  'message-queue': 'tool', 'file-storage': 'tool', 'search-engine': 'tool',
  'load-balancer': 'tool', 'cdn': 'tool', 'serverless-function': 'tool', 'batch-job': 'tool',
  'container-registry': 'tool', 'dns': 'tool', 'api-gateway': 'tool',
  'ui-component': 'step', 'api-controller': 'step', 'service-logic': 'step',
  'repository': 'step', 'middleware': 'step', 'plugin': 'step', 'module': 'step',
  'event-handler': 'step', 'job': 'step', 'adapter': 'step', 'saga': 'step',
  'workflow': 'step', 'library': 'step', 'config': 'step', 'migration': 'step',
  'test-suite': 'step',
  'class': 'fact', 'interface': 'fact', 'abstract-class': 'fact', 'function': 'fact',
  'enum': 'fact', 'type-alias': 'fact', 'c4-module': 'fact', 'schema': 'fact',
  'dto': 'fact', 'constant': 'fact', 'test-file': 'fact', 'migration-file': 'fact',
  'config-file': 'fact', 'script': 'fact',
}

/** The default layout config. A model may override any field. */
export const DEFAULT_LAYOUT: LayoutConfig = {
  direction: 'auto',
  rankGap: 120,
  nodeGap: 36,
  lane: 12,
  portGap: 12,
  labelMaxChars: 32,
  fontSize: 13,
  nodePadX: 14,
  nodePadY: 10,
  minW: 120,
  maxW: 280,
}
