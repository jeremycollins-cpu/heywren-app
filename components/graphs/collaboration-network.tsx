'use client'

// components/graphs/collaboration-network.tsx
// Interactive force-directed network graph showing collaboration patterns
// across the organization. Nodes = people, edges = interaction strength.
// Highlights siloed individuals and strong collaboration clusters.

import { useEffect, useRef, useState, useCallback } from 'react'
import { Users, AlertTriangle, Zap, Eye, EyeOff } from 'lucide-react'
import dynamic from 'next/dynamic'

// Lazy-load the graph to avoid SSR issues (canvas-based)
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false })

interface GraphNode {
  userId: string
  name: string
  avatar: string | null
  jobTitle: string | null
  department: string | null
  team: string | null
  role: string
  connectionCount: number
  totalInteractions: number
  avgStrength: number
}

interface GraphEdge {
  source: string
  target: string
  emailCount: number
  chatCount: number
  meetingCount: number
  commitmentCount: number
  strength: number
  total: number
}

interface Insights {
  totalNodes: number
  totalEdges: number
  avgConnections: number
  crossDeptCollaboration: number
  siloed: Array<{ userId: string; name: string; connectionCount: number }>
  connectors: Array<{ userId: string; name: string; connectionCount: number; totalInteractions: number }>
  bottlenecks: Array<{ userId: string; name: string; avgStrength: number; connectionCount: number }>
}

interface CollaborationNetworkProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  insights: Insights
}

// Color palette for departments
const DEPT_COLORS = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#f97316', // orange
  '#14b8a6', // teal
]

export default function CollaborationNetwork({ nodes, edges, insights }: CollaborationNetworkProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 })
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [highlightSiloed, setHighlightSiloed] = useState(false)

  // Build department color map
  const deptColorMap = useRef(new Map<string | null, string>())
  useEffect(() => {
    const depts = [...new Set(nodes.map(n => n.department))]
    depts.forEach((dept, i) => {
      deptColorMap.current.set(dept, DEPT_COLORS[i % DEPT_COLORS.length])
    })
  }, [nodes])

  // Responsive sizing
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setDimensions({ width: rect.width, height: Math.max(450, Math.min(600, rect.width * 0.6)) })
      }
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  const siloedIds = new Set(insights.siloed.map(s => s.userId))

  // Build graph data for react-force-graph
  const graphData = {
    nodes: nodes.map(n => ({
      id: n.userId,
      name: n.name,
      val: Math.max(3, Math.min(20, n.connectionCount * 2 + 3)), // node size
      color: deptColorMap.current.get(n.department) || '#94a3b8',
      jobTitle: n.jobTitle,
      department: n.department,
      connectionCount: n.connectionCount,
      totalInteractions: n.totalInteractions,
      isSiloed: siloedIds.has(n.userId),
    })),
    links: edges.map(e => ({
      source: e.source,
      target: e.target,
      value: e.strength,
      total: e.total,
    })),
  }

  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.name?.split(' ')[0] || '' // first name only
    const size = node.val || 5
    const x = node.x || 0
    const y = node.y || 0

    // Node circle
    ctx.beginPath()
    ctx.arc(x, y, size, 0, 2 * Math.PI)

    if (highlightSiloed && node.isSiloed) {
      // Pulsing red ring for siloed individuals
      ctx.fillStyle = '#fee2e2'
      ctx.fill()
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2.5
      ctx.stroke()
    } else {
      ctx.fillStyle = node.color || '#94a3b8'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Label
    if (showLabels && globalScale > 0.6) {
      const fontSize = Math.max(10, 12 / globalScale)
      ctx.font = `600 ${fontSize}px Inter, -apple-system, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = highlightSiloed && node.isSiloed ? '#dc2626' : '#374151'
      ctx.fillText(label, x, y + size + 3)
    }
  }, [showLabels, highlightSiloed])

  const linkCanvasObject = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const source = link.source
    const target = link.target
    if (!source?.x || !target?.x) return

    const strength = link.value || 0.1
    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(target.x, target.y)
    ctx.strokeStyle = `rgba(148, 163, 184, ${Math.min(0.8, strength * 0.6 + 0.1)})`
    ctx.lineWidth = Math.max(0.5, strength * 3)
    ctx.stroke()
  }, [])

  if (nodes.length === 0) return null

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white" style={{ letterSpacing: '-0.025em' }}>
              Collaboration Network
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Interaction patterns across the team from Slack, email, meetings, and commitments
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition ${
                showLabels
                  ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'
              }`}
            >
              {showLabels ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              Labels
            </button>
            <button
              onClick={() => setHighlightSiloed(!highlightSiloed)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition ${
                highlightSiloed
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              Siloed ({insights.siloed.length})
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex gap-6 mt-4">
          <div>
            <span className="text-2xl font-bold text-gray-900 dark:text-white">{insights.totalNodes}</span>
            <span className="text-xs text-gray-500 ml-1.5">people</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-gray-900 dark:text-white">{insights.totalEdges}</span>
            <span className="text-xs text-gray-500 ml-1.5">connections</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-gray-900 dark:text-white">{insights.avgConnections.toFixed(1)}</span>
            <span className="text-xs text-gray-500 ml-1.5">avg per person</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-gray-900 dark:text-white">{Math.round(insights.crossDeptCollaboration)}%</span>
            <span className="text-xs text-gray-500 ml-1.5">cross-team</span>
          </div>
        </div>
      </div>

      {/* Graph canvas */}
      <div ref={containerRef} className="relative bg-gray-50 dark:bg-gray-950">
        <ForceGraph2D
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          nodeCanvasObject={nodeCanvasObject}
          linkCanvasObject={linkCanvasObject}
          nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
            ctx.beginPath()
            ctx.arc(node.x || 0, node.y || 0, (node.val || 5) + 4, 0, 2 * Math.PI)
            ctx.fillStyle = color
            ctx.fill()
          }}
          onNodeHover={(node: any) => {
            if (node) {
              const match = nodes.find(n => n.userId === node.id)
              setHoveredNode(match || null)
            } else {
              setHoveredNode(null)
            }
          }}
          cooldownTicks={100}
          d3AlphaDecay={0.03}
          d3VelocityDecay={0.3}
          linkDirectionalParticles={0}
          enableZoomInteraction={true}
          enablePanInteraction={true}
        />

        {/* Hover tooltip */}
        {hoveredNode && (
          <div className="absolute top-4 right-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-4 min-w-[220px] pointer-events-none z-10">
            <p className="font-semibold text-gray-900 dark:text-white text-sm">{hoveredNode.name}</p>
            {hoveredNode.jobTitle && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{hoveredNode.jobTitle}</p>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 text-xs">
              <span className="text-gray-500">Connections</span>
              <span className="font-medium text-gray-900 dark:text-white text-right">{hoveredNode.connectionCount}</span>
              <span className="text-gray-500">Interactions</span>
              <span className="font-medium text-gray-900 dark:text-white text-right">{hoveredNode.totalInteractions}</span>
              <span className="text-gray-500">Avg Strength</span>
              <span className="font-medium text-gray-900 dark:text-white text-right">{(hoveredNode.avgStrength * 100).toFixed(0)}%</span>
            </div>
            {siloedIds.has(hoveredNode.userId) && (
              <div className="flex items-center gap-1.5 mt-3 px-2 py-1 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600 dark:text-red-400 font-medium">
                <AlertTriangle className="w-3 h-3" />
                Low collaboration — may need support
              </div>
            )}
          </div>
        )}
      </div>

      {/* Insights panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5 border-t border-gray-200 dark:border-gray-800">
        {/* Siloed individuals */}
        <div className="bg-red-50/50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-400">On the Fringe</span>
          </div>
          {insights.siloed.length === 0 ? (
            <p className="text-xs text-gray-500">No siloed individuals detected</p>
          ) : (
            <div className="space-y-2">
              {insights.siloed.slice(0, 5).map(person => (
                <div key={person.userId} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{person.name}</span>
                  <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                    {person.connectionCount} connection{person.connectionCount !== 1 ? 's' : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top connectors */}
        <div className="bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-400">Top Connectors</span>
          </div>
          {insights.connectors.length === 0 ? (
            <p className="text-xs text-gray-500">Not enough data yet</p>
          ) : (
            <div className="space-y-2">
              {insights.connectors.slice(0, 5).map(person => (
                <div key={person.userId} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{person.name}</span>
                  <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                    {person.totalInteractions} interactions
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottlenecks */}
        <div className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">Potential Bottlenecks</span>
          </div>
          {insights.bottlenecks.length === 0 ? (
            <p className="text-xs text-gray-500">No bottlenecks detected</p>
          ) : (
            <div className="space-y-2">
              {insights.bottlenecks.slice(0, 5).map(person => (
                <div key={person.userId} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{person.name}</span>
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    {person.connectionCount} deps, {Math.round(person.avgStrength * 100)}% avg
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Department legend */}
      <div className="px-5 pb-4 flex flex-wrap gap-3">
        {[...deptColorMap.current.entries()].map(([dept, color]) => (
          <div key={dept || 'none'} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-xs text-gray-500">{dept || 'No department'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
