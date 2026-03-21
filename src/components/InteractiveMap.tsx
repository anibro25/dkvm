import { useState, useRef, useCallback, useEffect, useMemo } from "react";

interface VillageFeature {
  type: "Feature";
  properties: {
    name: string;
    taluk: string;
    population: number;
    households: number;
    area_acres: number;
  };
  geometry: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
}

interface GeoData {
  type: "FeatureCollection";
  features: VillageFeature[];
}

const TALUK_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  Bantval:    { fill: "hsl(210, 60%, 50%)", stroke: "hsl(210, 60%, 35%)", label: "Bantwal" },
  Beltangadi: { fill: "hsl(145, 50%, 42%)", stroke: "hsl(145, 50%, 28%)", label: "Beltangadi" },
  Mangalore:  { fill: "hsl(350, 55%, 50%)", stroke: "hsl(350, 55%, 35%)", label: "Mangalore" },
  Puttur:     { fill: "hsl(35, 65%, 50%)",  stroke: "hsl(35, 65%, 35%)",  label: "Puttur" },
  Sulya:      { fill: "hsl(275, 45%, 50%)", stroke: "hsl(275, 45%, 35%)", label: "Sullia" },
  Kadaba:     { fill: "hsl(180, 50%, 40%)", stroke: "hsl(180, 50%, 28%)", label: "Kadaba" },
  Moodabidri: { fill: "hsl(55, 55%, 45%)",  stroke: "hsl(55, 55%, 30%)",  label: "Moodabidri" },
  Ullal:      { fill: "hsl(15, 60%, 50%)",  stroke: "hsl(15, 60%, 35%)",  label: "Ullal" },
  Mulki:      { fill: "hsl(310, 40%, 50%)", stroke: "hsl(310, 40%, 35%)", label: "Mulki" },
};

const SVG_WIDTH = 900;
const SVG_HEIGHT = 750;

// Geo bounds of Dakshina Kannada
const BOUNDS = {
  minLng: 74.77,
  maxLng: 75.68,
  minLat: 12.45,
  maxLat: 13.18,
};

function projectPoint(lng: number, lat: number): [number, number] {
  const x = ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * SVG_WIDTH;
  // Flip Y since lat increases upward but SVG y increases downward
  const y = ((BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * SVG_HEIGHT;
  return [x, y];
}

function coordsToPath(coords: number[][]): string {
  return coords
    .map((c, i) => {
      const [x, y] = projectPoint(c[0], c[1]);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ") + " Z";
}

function featureToPath(geometry: VillageFeature["geometry"]): string {
  if (geometry.type === "Polygon") {
    return (geometry.coordinates as number[][][])
      .map((ring) => coordsToPath(ring))
      .join(" ");
  } else if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][])
      .map((polygon) => polygon.map((ring) => coordsToPath(ring)).join(" "))
      .join(" ");
  }
  return "";
}

function getCentroid(geometry: VillageFeature["geometry"]): [number, number] {
  let coords: number[][];
  if (geometry.type === "Polygon") {
    coords = (geometry.coordinates as number[][][])[0];
  } else {
    // Use first polygon of MultiPolygon
    coords = (geometry.coordinates as number[][][][])[0][0];
  }
  let cx = 0, cy = 0;
  for (const c of coords) {
    cx += c[0];
    cy += c[1];
  }
  cx /= coords.length;
  cy /= coords.length;
  return projectPoint(cx, cy);
}

const InteractiveMap = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [geoData, setGeoData] = useState<GeoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredVillage, setHoveredVillage] = useState<VillageFeature | null>(null);
  const [selectedVillage, setSelectedVillage] = useState<VillageFeature | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetch("/dk_villages.geojson")
      .then((r) => r.json())
      .then((data: GeoData) => {
        setGeoData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const paths = useMemo(() => {
    if (!geoData) return [];
    return geoData.features.map((f) => ({
      feature: f,
      d: featureToPath(f.geometry),
      centroid: getCentroid(f.geometry),
    }));
  }, [geoData]);

  const filteredVillages = useMemo(() => {
    if (!searchQuery.trim() || !geoData) return [];
    const q = searchQuery.toLowerCase();
    return geoData.features.filter(
      (f) =>
        f.properties.name.toLowerCase().includes(q) ||
        f.properties.taluk.toLowerCase().includes(q)
    );
  }, [searchQuery, geoData]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    
    setScale((prev) => {
      const newScale = Math.min(Math.max(prev * delta, 0.5), 8);
      const ratio = newScale / prev;
      setPosition((pos) => ({
        x: mx - (mx - pos.x) * ratio,
        y: my - (my - pos.y) * ratio,
      }));
      return newScale;
    });
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    },
    [position]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      if (isDragging) {
        setPosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  // Touch support
  const lastPinchRef = useRef<number | null>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        setIsDragging(true);
        setDragStart({
          x: e.touches[0].clientX - position.x,
          y: e.touches[0].clientY - position.y,
        });
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastPinchRef.current = Math.sqrt(dx * dx + dy * dy);
      }
    },
    [position]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && isDragging) {
        setPosition({
          x: e.touches[0].clientX - dragStart.x,
          y: e.touches[0].clientY - dragStart.y,
        });
      } else if (e.touches.length === 2 && lastPinchRef.current) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ratio = dist / lastPinchRef.current;
        setScale((s) => Math.min(Math.max(s * ratio, 0.5), 8));
        lastPinchRef.current = dist;
      }
    },
    [isDragging, dragStart]
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    lastPinchRef.current = null;
  }, []);

  const resetView = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const zoomToVillage = useCallback(
    (feature: VillageFeature) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centroid = getCentroid(feature.geometry);
      const newScale = 4;
      setScale(newScale);
      setPosition({
        x: rect.width / 2 - centroid[0] * newScale,
        y: rect.height / 2 - centroid[1] * newScale,
      });
      setSelectedVillage(feature);
      setSearchQuery("");
    },
    []
  );

  const getColor = (taluk: string) => TALUK_COLORS[taluk] || { fill: "hsl(0,0%,70%)", stroke: "hsl(0,0%,50%)", label: taluk };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Loading village boundaries…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-foreground leading-tight">
              Dakshina Kannada Village Map
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {geoData?.features.length ?? 0} villages · Hover to explore, click for details
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search villages…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-44 sm:w-56 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {searchQuery && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg z-50 max-h-60 overflow-y-auto">
                  {filteredVillages.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No villages found</div>
                  ) : (
                    filteredVillages.slice(0, 25).map((f, i) => (
                      <button
                        key={i}
                        onClick={() => zoomToVillage(f)}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors flex justify-between items-center"
                      >
                        <span className="text-foreground">{f.properties.name}</span>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                          style={{
                            backgroundColor: getColor(f.properties.taluk).fill + "22",
                            color: getColor(f.properties.taluk).fill,
                          }}
                        >
                          {getColor(f.properties.taluk).label}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Zoom controls */}
            <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
              <button
                onClick={() => setScale((s) => Math.min(s * 1.3, 8))}
                className="h-7 w-7 flex items-center justify-center rounded text-foreground hover:bg-card transition-colors text-sm font-medium"
              >
                +
              </button>
              <button
                onClick={() => setScale((s) => Math.max(s * 0.7, 0.5))}
                className="h-7 w-7 flex items-center justify-center rounded text-foreground hover:bg-card transition-colors text-sm font-medium"
              >
                −
              </button>
              <button
                onClick={resetView}
                className="h-7 px-2 flex items-center justify-center rounded text-xs text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Taluk legend */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {Object.entries(TALUK_COLORS).map(([key, val]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: val.fill }} />
              <span className="text-xs text-muted-foreground">{val.label}</span>
            </div>
          ))}
        </div>
      </header>

      {/* Map area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
        style={{ background: "hsl(var(--muted))" }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <svg
          width={SVG_WIDTH}
          height={SVG_HEIGHT}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="will-change-transform"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          {/* Drop shadow filter */}
          <defs>
            <filter id="hover-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodOpacity="0.4" />
            </filter>
            <filter id="selected-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0" stdDeviation="5" floodOpacity="0.6" />
            </filter>
          </defs>

          {/* Village polygons */}
          {paths.map(({ feature, d }, i) => {
            const isHovered = hoveredVillage === feature;
            const isSelected = selectedVillage === feature;
            const color = getColor(feature.properties.taluk);

            return (
              <path
                key={i}
                d={d}
                fill={isHovered || isSelected ? color.fill : color.fill + "88"}
                stroke={isHovered || isSelected ? color.stroke : color.stroke + "66"}
                strokeWidth={isHovered || isSelected ? 2 / scale : 0.8 / scale}
                filter={isSelected ? "url(#selected-glow)" : isHovered ? "url(#hover-glow)" : undefined}
                style={{
                  cursor: "pointer",
                  transition: "fill 0.15s ease-out, stroke-width 0.15s ease-out",
                }}
                onMouseEnter={() => setHoveredVillage(feature)}
                onMouseLeave={() => setHoveredVillage(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedVillage(selectedVillage === feature ? null : feature);
                }}
              />
            );
          })}

          {/* Village name labels - show when zoomed in enough */}
          {scale >= 2.5 &&
            paths.map(({ feature, centroid }, i) => (
              <text
                key={`label-${i}`}
                x={centroid[0]}
                y={centroid[1]}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.max(6, 9 / scale)}
                fontWeight={500}
                fill="hsl(var(--foreground))"
                style={{
                  pointerEvents: "none",
                  textShadow: "0 0 3px hsl(var(--background)), 0 0 6px hsl(var(--background))",
                  paintOrder: "stroke",
                  stroke: "hsl(var(--background))",
                  strokeWidth: 2.5 / scale,
                }}
              >
                {feature.properties.name}
              </text>
            ))}
        </svg>

        {/* Hover tooltip */}
        {hoveredVillage && !isDragging && (
          <div
            className="fixed z-50 pointer-events-none"
            style={{
              left: `${mousePos.x + 16}px`,
              top: `${mousePos.y - 10}px`,
            }}
          >
            <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2 max-w-xs animate-in fade-in-0 zoom-in-95 duration-150">
              <div className="flex items-center gap-2 mb-0.5">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getColor(hoveredVillage.properties.taluk).fill }}
                />
                <span className="font-semibold text-sm text-foreground">
                  {hoveredVillage.properties.name}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {getColor(hoveredVillage.properties.taluk).label} Taluk
              </span>
              {hoveredVillage.properties.population > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Pop: {hoveredVillage.properties.population.toLocaleString()} · {hoveredVillage.properties.households.toLocaleString()} households
                </p>
              )}
            </div>
          </div>
        )}

        {/* Selected village panel */}
        {selectedVillage && (
          <div className="absolute bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-40">
            <div className="bg-card border border-border rounded-xl shadow-xl p-4 animate-in slide-in-from-bottom-4 fade-in-0 duration-300">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getColor(selectedVillage.properties.taluk).fill }}
                  />
                  <h2 className="font-semibold text-foreground text-base">
                    {selectedVillage.properties.name}
                  </h2>
                </div>
                <button
                  onClick={() => setSelectedVillage(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none p-1"
                >
                  ×
                </button>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Taluk</span>
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: getColor(selectedVillage.properties.taluk).fill + "22",
                      color: getColor(selectedVillage.properties.taluk).fill,
                    }}
                  >
                    {getColor(selectedVillage.properties.taluk).label}
                  </span>
                </div>
                {selectedVillage.properties.population > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Population</span>
                      <span className="text-foreground font-medium">
                        {selectedVillage.properties.population.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Households</span>
                      <span className="text-foreground font-medium">
                        {selectedVillage.properties.households.toLocaleString()}
                      </span>
                    </div>
                  </>
                )}
                {selectedVillage.properties.area_acres > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Area</span>
                    <span className="text-foreground font-medium">
                      {selectedVillage.properties.area_acres.toFixed(0)} acres
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Scale indicator */}
        <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm border border-border rounded-md px-2 py-1 text-xs text-muted-foreground">
          {Math.round(scale * 100)}%
        </div>
      </div>
    </div>
  );
};

export default InteractiveMap;
