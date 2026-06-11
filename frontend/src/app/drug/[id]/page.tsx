"use client";
/* eslint-disable react/no-unescaped-entities */

import React, { useState, useEffect } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Activity, ShieldAlert, AlertTriangle, AlertCircle, Info, FileText, ExternalLink, Sparkles, Loader2, CheckCircle2, XCircle, X, Download } from "lucide-react";
import FormattedContext from "@/components/FormattedContext";
import Link from "next/link";

// Types corresponding to Backend models
interface DrugDetail {
  id: string;
  spl_id: string;
  set_id: string;
  drug_name: string;
  version?: string;
  published_date?: string;
  status: string;
  created_at: string;
  raw_sections?: Record<string, { title: string; html: string }>;
  adverse_events: AdverseEvent[];
}

interface AdverseEvent {
  id: number;
  ae_term: string;
  original_term?: string;
  severity?: string;
  frequency?: string;
  section_code?: string;
  raw_context?: string;
  is_boxed_warning: boolean;
  meddra_pt_code?: number;
  meddra_pt_name?: string;
  meddra_soc_name?: string;
  meddra_hlt_name?: string;
  meddra_hlgt_name?: string;
  meddra_all_chains?: Array<{
    pt_code: number;
    pt_name: string;
    soc_name: string;
    hlt_name: string;
    hlgt_name: string;
  }>;
}

export default function DrugDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const id = params.id as string;
  const initialHighlight = searchParams.get("highlight") || "";

  const [drug, setDrug] = useState<DrugDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [activeSectionTab, setActiveSectionTab] = useState<string>("");
  const [expandedAeId, setExpandedAeId] = useState<number | null>(null);
  const [highlightTerm, setHighlightTerm] = useState<string>(initialHighlight);
  const [activeViewTab, setActiveViewTab] = useState<"severity" | "organ-system">("organ-system");
  const [showChainsModal, setShowChainsModal] = useState<boolean>(false);
  const [selectedChains, setSelectedChains] = useState<AdverseEvent["meddra_all_chains"]>([]);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // LOINC code human-readable names for reference
  const sectionLoincNames: Record<string, string> = {
    "34066-1": "Boxed Warning",
    "34084-4": "Adverse Reactions",
    "43685-7": "Warnings and Precautions",
    "34071-1": "Warnings",
    "34070-3": "Precautions",
    "90374-0": "Postmarketing Experience"
  };

  useEffect(() => {
    const fetchDrugDetail = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/drugs/${id}`);
        if (!res.ok) {
          throw new Error("Failed to fetch drug safety profile");
        }
        const data: DrugDetail = await res.json();
        setDrug(data);
        
        // Default active tab to Adverse Reactions (34084-4) or whatever is available
        if (data.raw_sections) {
          const availableCodes = Object.keys(data.raw_sections);
          if (availableCodes.includes("34084-4")) {
            setActiveSectionTab("34084-4");
          } else if (availableCodes.length > 0) {
            setActiveSectionTab(availableCodes[0]);
          }
        }
      } catch (err: any) {
        setError(err.message || "An error occurred while loading the drug details.");
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchDrugDetail();
    }
  }, [id]);

  // Handle trigger inspect text
  const handleInspectSource = (sectionCode: string, term: string) => {
    setActiveSectionTab(sectionCode);
    setHighlightTerm(term);
    
    // Smooth scroll right pane into view on mobile
    const rightPane = document.getElementById("original-label-pane");
    if (rightPane) {
      rightPane.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Helper to format date
  const formatDateString = (rawDate: string) => {
    if (!rawDate) return "Unknown";
    if (/^\d{8}$/.test(rawDate)) {
      return `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    }
    return rawDate;
  };

  const handleExportJson = () => {
    if (!drug) return;
    
    const exportData = {
      drug_name: drug.drug_name,
      set_id: drug.set_id,
      spl_id: drug.spl_id,
      published_date: drug.published_date,
      adverse_events: drug.adverse_events.map(ae => ({
        term: ae.ae_term,
        original_term: ae.original_term,
        severity: ae.severity,
        frequency: ae.frequency,
        is_boxed_warning: ae.is_boxed_warning,
        context: ae.raw_context,
        source_section: sectionLoincNames[ae.section_code || ""] || ae.section_code,
        meddra_info: {
          primary_pt_code: ae.meddra_pt_code,
          primary_pt_name: ae.meddra_pt_name,
          primary_soc_name: ae.meddra_soc_name,
          primary_hlt_name: ae.meddra_hlt_name,
          primary_hlgt_name: ae.meddra_hlgt_name,
          all_chains: ae.meddra_all_chains || []
        }
      }))
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${drug.drug_name.replace(/\s+/g, '_')}_AE_Profile.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: "100px", textAlign: "center" }}>
        <div className="spinner spinner-large" />
        <p style={{ color: "var(--text-secondary)", marginTop: "12px" }}>Mining adverse event profile data...</p>
      </div>
    );
  }

  if (error || !drug) {
    return (
      <div className="container" style={{ paddingTop: "80px" }}>
        <Link href="/" className="btn-back">
          <ArrowLeft size={16} /> Back to Dashboard
        </Link>
        <div className="error-alert" style={{ marginTop: "16px" }}>
          {error || "Drug profile not found"}
        </div>
      </div>
    );
  }

  // Group adverse events
  const aes = drug.adverse_events || [];
  const boxedAes = aes.filter(ae => ae.is_boxed_warning || ae.severity === "Boxed Warning");
  const severeAes = aes.filter(ae => !ae.is_boxed_warning && ae.severity === "Severe");
  const moderateAes = aes.filter(ae => !ae.is_boxed_warning && ae.severity === "Moderate");
  const mildAes = aes.filter(ae => !ae.is_boxed_warning && ae.severity === "Mild");

  const totalAeCount = aes.length;
  
  // Calculate stats progress bar
  const getPercentage = (count: number) => {
    if (totalAeCount === 0) return 0;
    return (count / totalAeCount) * 100;
  };

  // Helper function to safely highlight terms in XML-derived HTML body
  const highlightTermInHtml = (htmlContent: string, term: string) => {
    if (!term) return htmlContent;
    
    // Escape special regex characters in the term
    const escapedTerm = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    
    try {
      // Regex matches target phrase only when outside HTML tags
      // (?!<[^>]*)\b(term)\b(?![^<]*>)
      const regex = new RegExp(`(?!<[^>]*)\\b(${escapedTerm}s?)\\b(?![^<]*>)`, "gi");
      return htmlContent.replace(regex, '<span class="highlighted-term">$1</span>');
    } catch (e) {
      return htmlContent;
    }
  };

  // Group AEs by SOC and PT
  const getGroupedBySoc = (events: AdverseEvent[]) => {
    const socGroups: Record<string, { socName: string; pts: Record<string, { ptName: string; ptCode?: number; occurrences: AdverseEvent[] }> }> = {};

    events.forEach(ae => {
      const socName = ae.meddra_soc_name || "Unclassified / General Symptoms";
      const ptName = ae.meddra_pt_name || ae.ae_term;
      const ptCode = ae.meddra_pt_code;

      if (!socGroups[socName]) {
        socGroups[socName] = {
          socName,
          pts: {}
        };
      }

      if (!socGroups[socName].pts[ptName]) {
        socGroups[socName].pts[ptName] = {
          ptName,
          ptCode,
          occurrences: []
        };
      }

      socGroups[socName].pts[ptName].occurrences.push(ae);
    });

    // Sort SOCs alphabetically, but keep Unclassified at the bottom if it exists
    return Object.values(socGroups).sort((a, b) => {
      if (a.socName === "Unclassified / General Symptoms") return 1;
      if (b.socName === "Unclassified / General Symptoms") return -1;
      return a.socName.localeCompare(b.socName);
    });
  };

  const activeSection = drug.raw_sections?.[activeSectionTab];

  return (
    <div className="container">
      {/* Header breadcrumb */}
      <button onClick={() => router.push("/")} className="btn-back" style={{ background: "none", border: "none", cursor: "pointer" }}>
        <ArrowLeft size={16} /> Back to Dashboard
      </button>

      {/* AI Extraction Banner */}
      {drug.status !== 'completed' && (
        <div className={drug.status === 'failed' ? "error-alert" : "success-alert"} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: drug.status === 'failed' ? 'rgba(244,63,94,0.08)' : 'rgba(0,240,255,0.08)', borderColor: drug.status === 'failed' ? 'rgba(244,63,94,0.3)' : 'rgba(0,240,255,0.3)', color: drug.status === 'failed' ? 'var(--color-boxed-warning)' : 'var(--primary)', marginBottom: '20px', padding: '16px 20px', borderRadius: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {drug.status === 'extracting' ? (
              <Loader2 className="spinner-icon-spin" size={20} />
            ) : drug.status === 'failed' ? (
              <XCircle size={20} />
            ) : (
              <Sparkles size={20} />
            )}
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                {drug.status === 'extracting' && "AI Adverse Event Extraction in progress..."}
                {drug.status === 'pending' && "AI Extraction Pending"}
                {drug.status === 'failed' && "AI Extraction Failed"}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {drug.status === 'extracting' && "The NLP model is actively analyzing this drug label section-by-section."}
                {drug.status === 'pending' && "The label XML is successfully ingested. Adverse events must be mined using the AI processor."}
                {drug.status === 'failed' && "An error occurred during the last AI extraction attempt. Please retry."}
              </div>
            </div>
          </div>
          {drug.status !== 'extracting' && (
            <button 
              className="btn btn-primary-sparkle" 
              onClick={() => router.push(`/?extract=${drug.id}`)}
              style={{ fontSize: '0.85rem', padding: '8px 16px', gap: '4px' }}
            >
              <Sparkles size={14} />
              Mine safety profile
            </button>
          )}
        </div>
      )}

      {/* Title block */}
      <div className="detail-header-block">
        <div>
          <h1 style={{ fontSize: "2.25rem", marginBottom: "8px" }}>{drug.drug_name}</h1>
          <div style={{ display: "flex", gap: "24px", color: "var(--text-secondary)", fontSize: "0.85rem", flexWrap: "wrap" }}>
            <span><strong>Set ID:</strong> {drug.set_id}</span>
            <span><strong>Version:</strong> {drug.version || "1"}</span>
            <span><strong>Published:</strong> {formatDateString(drug.published_date || "")}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <button 
            onClick={handleExportJson}
            className="btn btn-secondary"
            style={{ fontSize: "0.85rem", padding: "8px 16px" }}
          >
            Export JSON <Download size={14} style={{ marginLeft: "4px" }} />
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="detail-layout">
        
        {/* Left Column: Structured Adverse Event Profile */}
        <div>
          
          {/* Summary Dashboard Card */}
          <div className="glass-panel card-padding severity-stats-card">
            <h3 style={{ fontSize: "1rem", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
              <Activity size={18} className="logo-highlight" />
              Safety Statistics Summary
            </h3>
            
            <div style={{ margin: "8px 0" }}>
              <div style={{ fontSize: "1.75rem", fontWeight: "700" }}>{totalAeCount}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                Extracted Adverse Event Associations
              </div>
            </div>

            {/* Boxed Warnings bar */}
            <div>
              <div className="stat-row">
                <span className="stat-label-group">
                  <ShieldAlert size={14} color="var(--color-boxed-warning)" />
                  Boxed Warnings
                </span>
                <span className="stat-value" style={{ color: "var(--color-boxed-warning)" }}>{boxedAes.length}</span>
              </div>
              <div className="stat-bar">
                <div className="stat-fill boxed-warning" style={{ width: `${getPercentage(boxedAes.length)}%` }} />
              </div>
            </div>

            {/* Severe bar */}
            <div>
              <div className="stat-row">
                <span className="stat-label-group">
                  <AlertTriangle size={14} color="var(--color-severe)" />
                  Severe Reactions
                </span>
                <span className="stat-value" style={{ color: "var(--color-severe)" }}>{severeAes.length}</span>
              </div>
              <div className="stat-bar">
                <div className="stat-fill severe" style={{ width: `${getPercentage(severeAes.length)}%` }} />
              </div>
            </div>

            {/* Moderate bar */}
            <div>
              <div className="stat-row">
                <span className="stat-label-group">
                  <AlertCircle size={14} color="var(--color-moderate)" />
                  Moderate Events
                </span>
                <span className="stat-value" style={{ color: "var(--color-moderate)" }}>{moderateAes.length}</span>
              </div>
              <div className="stat-bar">
                <div className="stat-fill moderate" style={{ width: `${getPercentage(moderateAes.length)}%` }} />
              </div>
            </div>

            {/* Mild bar */}
            <div>
              <div className="stat-row">
                <span className="stat-label-group">
                  <Info size={14} color="var(--color-mild)" />
                  Mild / Common
                </span>
                <span className="stat-value" style={{ color: "var(--color-mild)" }}>{mildAes.length}</span>
              </div>
              <div className="stat-bar">
                <div className="stat-fill mild" style={{ width: `${getPercentage(mildAes.length)}%` }} />
              </div>
            </div>
          </div>

          {/* View Tab Selector */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
            <h3 style={{ fontSize: "1rem", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
              Safety Profile Details
            </h3>
            <div style={{ display: "flex", background: "rgba(255, 255, 255, 0.03)", padding: "2px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
              <button
                onClick={() => setActiveViewTab("organ-system")}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                  fontWeight: "600",
                  border: "none",
                  cursor: "pointer",
                  background: activeViewTab === "organ-system" ? "var(--primary)" : "none",
                  color: activeViewTab === "organ-system" ? "#090a0f" : "var(--text-secondary)",
                  transition: "all 0.2s"
                }}
              >
                Organ System (MedDRA)
              </button>
              <button
                onClick={() => setActiveViewTab("severity")}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                  fontWeight: "600",
                  border: "none",
                  cursor: "pointer",
                  background: activeViewTab === "severity" ? "var(--primary)" : "none",
                  color: activeViewTab === "severity" ? "#090a0f" : "var(--text-secondary)",
                  transition: "all 0.2s"
                }}
              >
                Severity Level
              </button>
            </div>
          </div>

          {/* Extracted Adverse Events List */}
          {activeViewTab === "severity" ? (
            <div className="ae-group-section">
              {/* Boxed Warnings group */}
              {boxedAes.length > 0 && (
                <div>
                  <h4 className="ae-severity-header" style={{ color: "var(--color-boxed-warning)" }}>
                    <ShieldAlert size={16} /> Boxed Warnings ({boxedAes.length})
                  </h4>
                  <div className="ae-items-list">
                    {boxedAes.map(ae => (
                      <AdverseEventItem 
                        key={ae.id} 
                        ae={ae} 
                        allAes={aes}
                        sectionLoincNames={sectionLoincNames}
                        expanded={expandedAeId === ae.id}
                        onClick={() => setExpandedAeId(expandedAeId === ae.id ? null : ae.id)}
                        onInspect={handleInspectSource}
                        onShowChains={(chains) => { setSelectedChains(chains); setShowChainsModal(true); }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Severe group */}
              {severeAes.length > 0 && (
                <div>
                  <h4 className="ae-severity-header" style={{ color: "var(--color-severe)" }}>
                    <AlertTriangle size={16} /> Severe Reactions ({severeAes.length})
                  </h4>
                  <div className="ae-items-list">
                    {severeAes.map(ae => (
                      <AdverseEventItem 
                        key={ae.id} 
                        ae={ae} 
                        allAes={aes}
                        sectionLoincNames={sectionLoincNames}
                        expanded={expandedAeId === ae.id}
                        onClick={() => setExpandedAeId(expandedAeId === ae.id ? null : ae.id)}
                        onInspect={handleInspectSource}
                        onShowChains={(chains) => { setSelectedChains(chains); setShowChainsModal(true); }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Moderate group */}
              {moderateAes.length > 0 && (
                <div>
                  <h4 className="ae-severity-header" style={{ color: "var(--color-moderate)" }}>
                    <AlertCircle size={16} /> Moderate Events ({moderateAes.length})
                  </h4>
                  <div className="ae-items-list">
                    {moderateAes.map(ae => (
                      <AdverseEventItem 
                        key={ae.id} 
                        ae={ae} 
                        allAes={aes}
                        sectionLoincNames={sectionLoincNames}
                        expanded={expandedAeId === ae.id}
                        onClick={() => setExpandedAeId(expandedAeId === ae.id ? null : ae.id)}
                        onInspect={handleInspectSource}
                        onShowChains={(chains) => { setSelectedChains(chains); setShowChainsModal(true); }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Mild group */}
              {mildAes.length > 0 && (
                <div>
                  <h4 className="ae-severity-header" style={{ color: "var(--color-mild)" }}>
                    <Info size={16} /> Mild / Common ({mildAes.length})
                  </h4>
                  <div className="ae-items-list">
                    {mildAes.map(ae => (
                      <AdverseEventItem 
                        key={ae.id} 
                        ae={ae} 
                        allAes={aes}
                        sectionLoincNames={sectionLoincNames}
                        expanded={expandedAeId === ae.id}
                        onClick={() => setExpandedAeId(expandedAeId === ae.id ? null : ae.id)}
                        onInspect={handleInspectSource}
                        onShowChains={(chains) => { setSelectedChains(chains); setShowChainsModal(true); }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {totalAeCount === 0 && (
                <div className="glass-panel card-padding empty-state">
                  <div className="empty-icon">🩹</div>
                  <h3>No Adverse Events Extracted</h3>
                  <p style={{ color: "var(--text-muted)", marginTop: "6px" }}>The LLM didn&apos;t flag any adverse reactions in this label.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="ae-group-section">
              {/* Organ System (MedDRA) View */}
              {getGroupedBySoc(aes).map((soc) => (
                <div 
                  key={soc.socName} 
                  className="glass-panel" 
                  style={{ 
                    padding: "14px 16px", 
                    marginBottom: "12px", 
                    background: "rgba(22, 26, 43, 0.35)", 
                    borderRadius: "12px" 
                  }}
                >
                  {/* System Organ Class Title */}
                  <h4 style={{ 
                    fontSize: "0.85rem", 
                    fontWeight: "700", 
                    display: "flex", 
                    justifyContent: "space-between", 
                    alignItems: "center", 
                    borderBottom: "1px solid rgba(255,255,255,0.04)", 
                    paddingBottom: "8px", 
                    color: "var(--text-primary)",
                    margin: 0,
                    textTransform: "uppercase",
                    letterSpacing: "0.03em"
                  }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "1.1rem" }}>{socIcons[soc.socName] || "🩹"}</span>
                      {soc.socName}
                    </span>
                    <span className="badge badge-mild" style={{ background: "rgba(255,255,255,0.03)", borderColor: "var(--border-color)", color: "var(--text-secondary)", textTransform: "none", fontSize: "0.65rem", padding: "1px 6px" }}>
                      {Object.keys(soc.pts).length} term{Object.keys(soc.pts).length > 1 ? "s" : ""}
                    </span>
                  </h4>

                  {/* Preferred Terms in this SOC */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
                    {Object.values(soc.pts).map((pt) => (
                      <PreferredTermGroup 
                        key={pt.ptName} 
                        ptName={pt.ptName} 
                        ptCode={pt.ptCode}
                        occurrences={pt.occurrences}
                        sectionLoincNames={sectionLoincNames}
                        onInspect={handleInspectSource}
                        onShowChains={(chains) => { setSelectedChains(chains); setShowChainsModal(true); }}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {totalAeCount === 0 && (
                <div className="glass-panel card-padding empty-state">
                  <div className="empty-icon">🩹</div>
                  <h3>No Adverse Events Extracted</h3>
                  <p style={{ color: "var(--text-muted)", marginTop: "6px" }}>The LLM didn&apos;t flag any adverse reactions in this label.</p>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Right Column: Original Label Document Viewer */}
        <div id="original-label-pane" className="glass-panel card-padding" style={{ display: "flex", flexDirection: "column", height: "fit-content", minHeight: "600px" }}>
          <h2 className="card-title">
            <FileText size={20} className="logo-highlight" />
            Source Label Sections
          </h2>

          {/* Document Section Tabs */}
          <div className="tabs-container" style={{ overflowX: "auto", whiteSpace: "nowrap", display: "flex", paddingBottom: "4px" }}>
            {drug.raw_sections && Object.entries(drug.raw_sections).map(([code, sect]) => (
              <button
                key={code}
                className={`tab-btn ${activeSectionTab === code ? "active" : ""}`}
                onClick={() => {
                  setActiveSectionTab(code);
                  setHighlightTerm(""); // Clear highlight when switching sections manually
                }}
              >
                {sectionLoincNames[code] || sect.title}
              </button>
            ))}
          </div>

          {/* Section HTML Render Content */}
          {activeSection ? (
            <div className="section-body-html" style={{ flex: 1 }}>
              <h3 style={{ fontSize: "1.1rem", marginBottom: "16px", color: "var(--text-primary)" }}>
                {activeSection.title}
              </h3>
              
              {highlightTerm && (
                <div className="success-alert" style={{ background: "rgba(0, 240, 255, 0.05)", borderColor: "var(--primary-glow)", color: "var(--primary)", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <span>Highlighting matching term: <strong>{highlightTerm}</strong></span>
                  <button 
                    onClick={() => setHighlightTerm("")}
                    style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: "bold" }}
                  >
                    Clear Highlight
                  </button>
                </div>
              )}

              <div 
                dangerouslySetInnerHTML={{ 
                  __html: highlightTermInHtml(activeSection.html, highlightTerm) 
                }} 
              />
            </div>
          ) : (
            <div className="empty-state" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div className="empty-icon">📄</div>
              <h3>Select a tab above to view original label text</h3>
            </div>
          )}

        </div>

      </div>

      {/* Chains Modal */}
      {showChainsModal && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 1000
        }}>
          <div className="glass-panel" style={{
            background: "var(--background)",
            padding: "24px",
            borderRadius: "16px",
            width: "90%",
            maxWidth: "600px",
            maxHeight: "80vh",
            overflowY: "auto",
            boxShadow: "0 20px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <span>🧬</span> Multiple MedDRA Chain Mappings
              </h3>
              <button 
                onClick={() => setShowChainsModal(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
              >
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "16px" }}>
              This term mapped to multiple distinct Preferred Terms (PTs) or System Organ Classes (SOCs). All possible matches are revealed below:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {selectedChains?.map((chain, idx) => (
                <div key={idx} style={{ 
                  padding: "12px", 
                  background: "rgba(0, 240, 255, 0.02)", 
                  border: "1px solid rgba(0, 240, 255, 0.1)", 
                  borderRadius: "8px",
                  fontSize: "0.8rem"
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
                    <div><span style={{ color: "var(--text-muted)" }}>Preferred Term (PT):</span> <strong style={{ color: "var(--text-primary)" }}>{chain.pt_name}</strong></div>
                    <div><span style={{ color: "var(--text-muted)" }}>Organ Class (SOC):</span> <strong style={{ color: "var(--text-primary)" }}>{chain.soc_name}</strong></div>
                    {chain.hlt_name && <div style={{ gridColumn: "span 2" }}><span style={{ color: "var(--text-muted)" }}>High Level Term (HLT):</span> <span style={{ color: "var(--text-secondary)" }}>{chain.hlt_name}</span></div>}
                    {chain.hlgt_name && <div style={{ gridColumn: "span 2" }}><span style={{ color: "var(--text-muted)" }}>High Level Group Term (HLGT):</span> <span style={{ color: "var(--text-secondary)" }}>{chain.hlgt_name}</span></div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Single Adverse Event list item rendering component
interface AdverseEventItemProps {
  ae: AdverseEvent;
  sectionLoincNames: Record<string, string>;
  expanded: boolean;
  onClick: () => void;
  onInspect: (sectionCode: string, term: string) => void;
  allAes?: AdverseEvent[];
  onShowChains?: (chains: AdverseEvent["meddra_all_chains"]) => void;
}

function AdverseEventItem({ ae, sectionLoincNames, expanded, onClick, onInspect, allAes, onShowChains }: AdverseEventItemProps) {
  const sevClass = ae.is_boxed_warning 
    ? "boxed-warning" 
    : (ae.severity || "").toLowerCase();

  // Find other occurrences of the same concept (PT or term name)
  const otherOccurs = allAes
    ? allAes.filter(o => o.id !== ae.id && (o.meddra_pt_name || o.ae_term).toLowerCase() === (ae.meddra_pt_name || ae.ae_term).toLowerCase())
    : [];

  return (
    <div className={`ae-detail-item ${expanded ? "active" : ""}`}>
      
      {/* Title summary header line */}
      <div className="ae-detail-summary" onClick={onClick}>
        <span className="ae-detail-name">
          {ae.ae_term}
          {otherOccurs.length > 0 && (
            <span style={{ marginLeft: "8px", fontSize: "0.7rem", color: "var(--primary)", fontWeight: "normal", background: "rgba(0, 240, 255, 0.05)", padding: "1px 5px", borderRadius: "4px", border: "1px solid rgba(0, 240, 255, 0.15)" }}>
              {otherOccurs.length + 1} mentions
            </span>
          )}
        </span>
        
        <div className="ae-detail-meta">
          {ae.frequency && ae.frequency !== "Unknown" && (
            <span className="badge badge-mild" style={{ background: "rgba(255,255,255,0.03)", borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
              {ae.frequency}
            </span>
          )}
          <span className={`badge badge-${sevClass}`} style={{ fontSize: "0.7rem", padding: "2px 8px" }}>
            {ae.is_boxed_warning ? "Box Warning" : ae.severity || "Moderate"}
          </span>
        </div>
      </div>

      {/* Expanded details container */}
      {expanded && (
        <div className="ae-detail-expanded">
          {/* MedDRA Taxonomy block */}
          {ae.meddra_pt_name && (
            <div style={{ 
              padding: "10px 12px", 
              background: "rgba(0, 240, 255, 0.02)", 
              border: "1px solid rgba(0, 240, 255, 0.1)", 
              borderRadius: "8px",
              fontSize: "0.75rem",
              marginBottom: "12px"
            }}>
              <div style={{ fontWeight: 600, color: "var(--primary)", marginBottom: "6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span>🧬</span> MedDRA Taxonomy Classification
                </span>
                {ae.meddra_all_chains && ae.meddra_all_chains.length > 1 && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onShowChains) onShowChains(ae.meddra_all_chains!);
                    }}
                    style={{
                      background: "rgba(0, 240, 255, 0.1)",
                      border: "1px solid rgba(0, 240, 255, 0.2)",
                      color: "var(--primary)",
                      borderRadius: "6px",
                      padding: "4px 8px",
                      fontSize: "0.7rem",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px"
                    }}
                  >
                    <span>+{ae.meddra_all_chains.length - 1} More Chains</span>
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
                <div><span style={{ color: "var(--text-muted)" }}>Preferred Term (PT):</span> <strong style={{ color: "var(--text-primary)" }}>{ae.meddra_pt_name}</strong> <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>({ae.meddra_pt_code})</span></div>
                <div><span style={{ color: "var(--text-muted)" }}>Organ Class (SOC):</span> <strong style={{ color: "var(--text-primary)" }}>{ae.meddra_soc_name}</strong></div>
                {ae.meddra_hlt_name && <div style={{ gridColumn: "span 2" }}><span style={{ color: "var(--text-muted)" }}>High Level Term (HLT):</span> <span style={{ color: "var(--text-secondary)" }}>{ae.meddra_hlt_name}</span></div>}
                {ae.meddra_hlgt_name && <div style={{ gridColumn: "span 2" }}><span style={{ color: "var(--text-muted)" }}>High Level Group Term (HLGT):</span> <span style={{ color: "var(--text-secondary)" }}>{ae.meddra_hlgt_name}</span></div>}
              </div>
            </div>
          )}

          {ae.original_term && ae.original_term.toLowerCase() !== ae.ae_term.toLowerCase() && (
            <div style={{ marginBottom: "8px", fontSize: "0.85rem" }}>
              <span style={{ color: "var(--text-muted)" }}>Label Phrasing:</span>{" "}
              <strong style={{ color: "var(--text-primary)" }}>&quot;{ae.original_term}&quot;</strong>
            </div>
          )}

          {otherOccurs.length > 0 && (
            <div style={{ marginBottom: "8px", fontSize: "0.8rem", color: "var(--primary)", display: "flex", gap: "6px", alignItems: "center" }}>
              <span>🔄</span> Multi-mention term (reported in: {
                Array.from(new Set([ae, ...otherOccurs].map(o => sectionLoincNames[o.section_code!] || o.section_code))).join(", ")
              })
            </div>
          )}

          {ae.raw_context && (
            <div style={{ marginBottom: "8px" }}>
              <FormattedContext 
                text={ae.raw_context}
                term={ae.original_term || ae.ae_term}
                severity={ae.severity}
                isBoxedWarning={ae.is_boxed_warning}
              />
            </div>
          )}

          {ae.section_code && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", borderTop: "1px dashed var(--border-color)", paddingTop: "8px" }}>
              <span style={{ color: "var(--text-muted)" }}>
                Source Section: <strong>{sectionLoincNames[ae.section_code] || ae.section_code}</strong>
              </span>
              <button 
                className="btn-inspect" 
                onClick={() => onInspect(ae.section_code!, ae.original_term || ae.ae_term)}
              >
                Inspect Original Text &rarr;
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const socIcons: Record<string, string> = {
  "Blood and lymphatic system disorders": "🩸",
  "Cardiac disorders": "❤️",
  "Congenital, familial and genetic disorders": "🧬",
  "Ear and labyrinth disorders": "👂",
  "Endocrine disorders": "🦋",
  "Eye disorders": "👁️",
  "Gastrointestinal disorders": "🤢",
  "General disorders and administration site conditions": "🏥",
  "Hepatobiliary disorders": "🍺",
  "Immune system disorders": "🛡️",
  "Infections and infestations": "🦠",
  "Injury, poisoning and procedural complications": "🤕",
  "Investigations": "🔬",
  "Metabolism and nutrition disorders": "🍎",
  "Musculoskeletal and connective tissue disorders": "💪",
  "Neoplasms benign, malignant and unspecified (incl cysts and polyps)": "🎗️",
  "Nervous system disorders": "🧠",
  "Pregnancy, puerperium and perinatal conditions": "🤰",
  "Product issues": "📦",
  "Psychiatric disorders": "💭",
  "Renal and urinary disorders": "🚽",
  "Reproductive system and breast disorders": "🎀",
  "Respiratory, thoracic and mediastinal disorders": "🫁",
  "Skin and subcutaneous tissue disorders": "🧴",
  "Social circumstances": "👥",
  "Surgical and medical procedures": "🎚️",
  "Vascular disorders": "🫀",
};

interface PreferredTermGroupProps {
  ptName: string;
  ptCode?: number;
  occurrences: AdverseEvent[];
  sectionLoincNames: Record<string, string>;
  onInspect: (sectionCode: string, term: string) => void;
  onShowChains?: (chains: AdverseEvent["meddra_all_chains"]) => void;
}

export function PreferredTermGroup({ ptName, ptCode, occurrences, sectionLoincNames, onInspect, onShowChains }: PreferredTermGroupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedOccurId, setExpandedOccurId] = useState<number | null>(null);

  // Find max severity
  const severities = occurrences.map(o => (o.severity || "").toLowerCase());
  const isBoxed = occurrences.some(o => o.is_boxed_warning || o.severity === "Boxed Warning");
  const isSevere = !isBoxed && severities.includes("severe");
  const isMild = !isBoxed && !isSevere && severities.includes("mild");
  
  const ptSevClass = isBoxed ? "boxed-warning" : isSevere ? "severe" : isMild ? "mild" : "moderate";
  const ptBadgeText = isBoxed ? "Box Warning" : isSevere ? "Severe" : isMild ? "Mild" : "Moderate";

  const allSections = Array.from(new Set(occurrences.map(o => sectionLoincNames[o.section_code!] || o.section_code)));

  return (
    <div className={`ae-detail-item ${isOpen ? "active" : ""}`} style={{ border: "1px solid rgba(255,255,255,0.03)", background: "rgba(9, 10, 15, 0.2)" }}>
      {/* PT Header */}
      <div 
        className="ae-detail-summary" 
        onClick={() => setIsOpen(!isOpen)}
        style={{ padding: "10px 14px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="ae-detail-name" style={{ fontSize: "0.9rem", fontWeight: 600 }}>
            {ptName}
            {occurrences[0]?.meddra_all_chains && occurrences[0].meddra_all_chains.length > 1 && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  if (onShowChains) onShowChains(occurrences[0].meddra_all_chains);
                }}
                style={{
                  background: "rgba(0, 240, 255, 0.1)",
                  border: "1px solid rgba(0, 240, 255, 0.2)",
                  color: "var(--primary)",
                  borderRadius: "6px",
                  padding: "2px 6px",
                  fontSize: "0.65rem",
                  cursor: "pointer",
                  marginLeft: "8px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px"
                }}
              >
                <span>+{occurrences[0].meddra_all_chains.length - 1} Chains</span>
              </button>
            )}
          </span>
          {occurrences.length > 1 && (
            <span className="badge badge-mild" style={{ background: "rgba(0, 240, 255, 0.05)", borderColor: "rgba(0, 240, 255, 0.2)", color: "var(--primary)", fontSize: "0.65rem", padding: "1px 6px", textTransform: "none", animation: "pulse-glow-cyan 3s infinite" }}>
              {occurrences.length} mentions
            </span>
          )}
        </div>
        
        <div className="ae-detail-meta">
          <span className={`badge badge-${ptSevClass}`} style={{ fontSize: "0.65rem", padding: "2px 6px" }}>
            {ptBadgeText}
          </span>
        </div>
      </div>

      {/* Occurrences details inside */}
      {isOpen && (
        <div className="ae-detail-expanded" style={{ background: "rgba(4, 5, 10, 0.35)", display: "flex", flexDirection: "column", gap: "10px", borderTop: "1px solid var(--border-color)" }}>
          
          {/* MedDRA Taxonomy block */}
          {occurrences[0]?.meddra_pt_name && (
            <div style={{ 
              padding: "10px 12px", 
              background: "rgba(0, 240, 255, 0.02)", 
              border: "1px solid rgba(0, 240, 255, 0.12)", 
              borderRadius: "8px",
              fontSize: "0.75rem",
              marginBottom: "4px"
            }}>
              <div style={{ fontWeight: 600, color: "var(--primary)", marginBottom: "6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span>🧬</span> MedDRA Taxonomy Classification
                </span>
                {occurrences[0]?.meddra_all_chains && occurrences[0].meddra_all_chains.length > 1 && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onShowChains) onShowChains(occurrences[0].meddra_all_chains!);
                    }}
                    style={{
                      background: "rgba(0, 240, 255, 0.1)",
                      border: "1px solid rgba(0, 240, 255, 0.2)",
                      color: "var(--primary)",
                      borderRadius: "6px",
                      padding: "4px 8px",
                      fontSize: "0.7rem",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px"
                    }}
                  >
                    <span>+{occurrences[0].meddra_all_chains.length - 1} More Chains</span>
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
                <div><span style={{ color: "var(--text-muted)" }}>Preferred Term (PT):</span> <strong style={{ color: "var(--text-primary)" }}>{occurrences[0].meddra_pt_name}</strong> <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>({occurrences[0].meddra_pt_code})</span></div>
                <div><span style={{ color: "var(--text-muted)" }}>Organ Class (SOC):</span> <strong style={{ color: "var(--text-primary)" }}>{occurrences[0].meddra_soc_name}</strong></div>
                {occurrences[0].meddra_hlt_name && <div style={{ gridColumn: "span 2" }}><span style={{ color: "var(--text-muted)" }}>High Level Term (HLT):</span> <span style={{ color: "var(--text-secondary)" }}>{occurrences[0].meddra_hlt_name}</span></div>}
                {occurrences[0].meddra_hlgt_name && <div style={{ gridColumn: "span 2" }}><span style={{ color: "var(--text-muted)" }}>High Level Group Term (HLGT):</span> <span style={{ color: "var(--text-secondary)" }}>{occurrences[0].meddra_hlgt_name}</span></div>}
              </div>
            </div>
          )}

          {occurrences.length > 1 && (
            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontStyle: "italic", borderBottom: "1px dashed var(--border-color)", paddingBottom: "6px" }}>
              🔄 Extracted {occurrences.length} times under different contexts (in {allSections.join(", ")})
            </div>
          )}

          {occurrences.map((ae) => {
            const isSingle = occurrences.length === 1;
            const isOccurExpanded = isSingle || expandedOccurId === ae.id;

            return (
              <div 
                key={ae.id} 
                style={{ 
                  padding: isSingle ? "0" : "8px 12px", 
                  background: isSingle ? "none" : "rgba(255, 255, 255, 0.01)", 
                  border: isSingle ? "none" : "1px solid rgba(255, 255, 255, 0.03)", 
                  borderRadius: "6px" 
                }}
              >
                {/* Occurrence sub-header if there are multiple */}
                {!isSingle && (
                  <div 
                    onClick={() => setExpandedOccurId(expandedOccurId === ae.id ? null : ae.id)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", fontSize: "0.8rem", paddingBottom: isOccurExpanded ? "8px" : "0" }}
                  >
                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      &quot;{ae.original_term || ae.ae_term}&quot;
                    </span>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      {ae.frequency && ae.frequency !== "Unknown" && (
                        <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>{ae.frequency}</span>
                      )}
                      <span className={`badge badge-${ae.is_boxed_warning ? 'boxed-warning' : (ae.severity || 'moderate').toLowerCase()}`} style={{ fontSize: "0.65rem", padding: "1px 5px" }}>
                        {ae.is_boxed_warning ? "Box" : ae.severity}
                      </span>
                    </div>
                  </div>
                )}

                {/* Sub details */}
                {isOccurExpanded && (
                  <div style={{ fontSize: "0.8rem", marginTop: isSingle ? "0" : "4px" }}>
                    {ae.original_term && ae.original_term.toLowerCase() !== ptName.toLowerCase() && (
                      <div style={{ marginBottom: "6px" }}>
                        <span style={{ color: "var(--text-muted)" }}>Label Phrasing:</span>{" "}
                        <strong style={{ color: "var(--text-primary)" }}>&quot;{ae.original_term}&quot;</strong>
                      </div>
                    )}

                    {ae.frequency && ae.frequency !== "Unknown" && isSingle && (
                      <div style={{ marginBottom: "6px" }}>
                        <span style={{ color: "var(--text-muted)" }}>Reported Frequency:</span>{" "}
                        <strong style={{ color: "var(--text-primary)" }}>{ae.frequency}</strong>
                      </div>
                    )}

                    {ae.raw_context && (
                      <div style={{ marginTop: "8px" }}>
                        <FormattedContext 
                          text={ae.raw_context}
                          term={ae.original_term || ae.ae_term}
                          severity={ae.severity}
                          isBoxedWarning={ae.is_boxed_warning}
                        />
                      </div>
                    )}

                    {ae.section_code && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", borderTop: "1px dashed var(--border-color)", paddingTop: "6px" }}>
                        <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                          Source: <strong>{sectionLoincNames[ae.section_code] || ae.section_code}</strong>
                        </span>
                        <button 
                          className="btn-inspect" 
                          onClick={() => onInspect(ae.section_code!, ae.original_term || ae.ae_term)}
                          style={{ fontSize: "0.75rem" }}
                        >
                          Inspect Original Text &rarr;
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
