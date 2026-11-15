/**
 * React Flow canvas for both map levels (overview and site).
 * The layout is fixed: nothing can be dragged or connected. Zoom with wheel or two-finger pinch,
 * pan by dragging – with the mouse or one finger.
 */
import { useEffect, useMemo } from 'react';
import { Background, BackgroundVariant, Controls, ReactFlow, useEdgesState, useNodesState, useReactFlow, type FitViewOptions } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowNode, Layout, LinkFlowEdge } from '../../utils/layout';
import { BackdropNode, DeviceNode, PortalNode, SiteNode, ZoneNode } from './nodes';
import { LinkEdge } from './LinkEdge';
import { useMapUi } from './MapUiContext';
import { useIsMobile } from '../../hooks/useMediaQuery';

const nodeTypes = { device: DeviceNode, zone: ZoneNode, portal: PortalNode, site: SiteNode, backdrop: BackdropNode };
const edgeTypes = { link: LinkEdge };
/** Width kept free on the left for the legend (desktop) */
const LEGEND_INSET = 262;

interface Props {
  layout: Layout;
  label: string;
  colorMode: 'light' | 'dark';
  /** Centre this node (set by the search); `nonce` repeats the request for the same node */
  focus: { id: string; nonce: number } | null;
}

/** Lives inside <ReactFlow>, where the viewport can be controlled. */
function FocusOn({ focus }: { focus: Props['focus'] }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!focus) return;
    // Slightly after the initial fit of a freshly opened site, so this one wins
    const timer = window.setTimeout(() => void fitView({ nodes: [{ id: focus.id }], maxZoom: 1.1, padding: 2.5, duration: 500 }), 160);
    return () => window.clearTimeout(timer);
  }, [focus, fitView]);
  return null;
}

export function MapCanvas({ layout, label, colorMode, focus }: Props) {
  const { clearSelection, selectedId, setHover } = useMapUi();
  const [nodes, , onNodesChange] = useNodesState<FlowNode>(layout.nodes);
  const [edges, , onEdgesChange] = useEdgesState<LinkFlowEdge>(layout.edges);
  const isMobile = useIsMobile();
  // Fit the map next to the legend, not underneath it
  const fit = useMemo<FitViewOptions>(
    () => ({ padding: { top: '20px', right: '20px', bottom: '20px', left: isMobile ? '20px' : `${LEGEND_INSET}px` } }),
    [isMobile],
  );
  // On a phone a whole site would be too small to read: open it readable and pan from there.
  // The fit button still shows everything.
  const initialFit = useMemo<FitViewOptions>(() => (isMobile && layout.nodes.length > 12 ? { ...fit, minZoom: 0.6 } : fit), [fit, isMobile, layout.nodes.length]);


  return (
    <div className="h-full w-full">
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode={colorMode}
      fitView
      fitViewOptions={initialFit}
      minZoom={0.15}
      maxZoom={2.2}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      zoomOnPinch
      panOnDrag
      zoomOnDoubleClick
      onPaneClick={() => selectedId && clearSelection()}
      onMoveStart={() => setHover(null)}
      aria-label={label}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
      <Controls showInteractive={false} position="bottom-right" fitViewOptions={fit} />
      <FocusOn focus={focus} />
    </ReactFlow>
    </div>
  );
}
