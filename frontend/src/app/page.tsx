"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Plus, Trash2, ArrowRight, ShieldAlert, Sparkles, Database, FileText, CheckCircle2, XCircle, Loader2, X } from "lucide-react";
import FormattedContext from "@/components/FormattedContext";

// Types corresponding to Backend models
interface Drug {
  id: string;
  spl_id: string;
  set_id: string;
  drug_name: string;
  version?: string;
  published_date?: string;
  status: string;
  created_at: string;
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
  created_at: string;
}

interface SearchResultItem {
  drug: Drug;
  adverse_event: AdverseEvent;
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"drugs" | "search">("drugs");
  
  // Ingestion State
  const [splId, setSplId] = useState("");
  const [setId, setSetId] = useState("");
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestStatus, setIngestStatus] = useState<{ message: string; isError: boolean } | null>(null);
  
  // DailyMed API Search State
  const [dmSearchQuery, setDmSearchQuery] = useState("");
  const [dmResults, setDmResults] = useState<any[]>([]);
  const [dmLoading, setDmLoading] = useState(false);
  
  // Drugs list State
  const [drugs, setDrugs] = useState<Drug[]>([]);
  const [drugsLoading, setDrugsLoading] = useState(true);
  const [drugFilter, setDrugFilter] = useState("");
  
  // AE Search State
  const [aeSearchQuery, setAeSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Extraction (SSE) State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeExtractingDrug, setActiveExtractingDrug] = useState<{ id: string; name: string } | null>(null);
  const [extractionLog, setExtractionLog] = useState<Array<{
    section_code?: string;
    section_title: string;
    status: 'pending' | 'processing' | 'done' | 'failed';
    count?: number;
    message?: string;
  }>>([]);
  const [extractionStatus, setExtractionStatus] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [overallMessage, setOverallMessage] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);

  const startExtraction = (drugId: string, drugName: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setActiveExtractingDrug({ id: drugId, name: drugName });
    setIsModalOpen(true);
    setExtractionStatus('running');
    setOverallMessage('Connecting to AI extraction stream...');
    setExtractionLog([]);

    const provider = localStorage.getItem("llm_provider") || "";
    const url = provider ? `${API_BASE_URL}/api/drugs/${drugId}/extract?provider=${provider}` : `${API_BASE_URL}/api/drugs/${drugId}/extract`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.status === 'processing') {
          setExtractionLog(prev => {
            const index = prev.findIndex(item => item.section_code === data.section_code);
            if (index >= 0) {
              const updated = [...prev];
              updated[index] = {
                ...updated[index],
                status: 'processing',
                message: data.message
              };
              return updated;
            } else {
              return [...prev, {
                section_code: data.section_code,
                section_title: data.section_title,
                status: 'processing',
                message: data.message
              }];
            }
          });
          setOverallMessage(data.message);
        } 
        else if (data.status === 'section_done') {
          setExtractionLog(prev => {
            return prev.map(item => {
              if (item.section_code === data.section_code) {
                return {
                  ...item,
                  status: 'done',
                  count: data.count,
                  message: `Completed! Extracted ${data.count} AEs`
                };
              }
              return item;
            });
          });
        }
        else if (data.status === 'section_failed') {
          setExtractionLog(prev => {
            return prev.map(item => {
              if (item.section_code === data.section_code) {
                return {
                  ...item,
                  status: 'failed',
                  message: data.message
                };
              }
              return item;
            });
          });
        }
        else if (data.status === 'completed') {
          setExtractionStatus('success');
          setOverallMessage(data.message || 'Extraction complete!');
          eventSource.close();
          fetchDrugs();
        }
        else if (data.status === 'failed') {
          setExtractionStatus('failed');
          setOverallMessage(data.message || 'Extraction failed.');
          eventSource.close();
          fetchDrugs();
        }
      } catch (err) {
        console.error("Error parsing SSE data:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("EventSource failed:", err);
      setExtractionStatus('failed');
      setOverallMessage("Error: Lost connection to the server extraction stream.");
      eventSource.close();
      fetchDrugs();
    };
  };

  const closeExtractionModal = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsModalOpen(false);
    setActiveExtractingDrug(null);
    setExtractionLog([]);
    setExtractionStatus('idle');
  };

  // Close connection on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // Sample SPL/SetIDs for easy testing
  const sampleSuggestions = [
    { name: "Lisinopril", setId: "40e6b627-63dc-4d52-aaa8-750663ad86c2" },
    { name: "Ibuprofen", setId: "7d1950b4-3237-4512-bab3-4c7364bdd618" },
    { name: "Metformin", setId: "0569d5d5-70df-46d7-954a-fe00542a7191" }
  ];

  // Fetch all ingested drugs
  const fetchDrugs = async (searchName?: string) => {
    setDrugsLoading(true);
    try {
      const url = searchName 
        ? `${API_BASE_URL}/api/drugs?q=${encodeURIComponent(searchName)}` 
        : `${API_BASE_URL}/api/drugs`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setDrugs(data);
      }
    } catch (err) {
      console.error("Failed to fetch drugs:", err);
    } finally {
      setDrugsLoading(false);
    }
  };

  useEffect(() => {
    fetchDrugs();
  }, []);

  useEffect(() => {
    const extractId = searchParams.get("extract");
    if (extractId && drugs.length > 0) {
      const targetDrug = drugs.find(d => d.id === extractId || d.spl_id === extractId);
      if (targetDrug && targetDrug.status !== 'extracting') {
        startExtraction(targetDrug.id, targetDrug.drug_name);
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
      }
    }
  }, [searchParams, drugs]);

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      fetchDrugs(drugFilter);
    }, 300);
    return () => clearTimeout(delayDebounce);
  }, [drugFilter]);

  // Handle drug deletion
  const handleDeleteDrug = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this drug profile? This will delete all extracted adverse events associated with it.")) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/drugs/${id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setDrugs(drugs.filter(d => d.id !== id && d.spl_id !== id));
        // Reset search results if we deleted a drug
        if (aeSearchQuery) {
          executeAeSearch();
        }
      }
    } catch (err) {
      console.error("Failed to delete drug:", err);
    }
  };

  // Handle Ingest submit
  const handleIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!splId.trim() && !setId.trim()) {
      setIngestStatus({ message: "Please specify either an SPL ID or a Set ID.", isError: true });
      return;
    }

    setIngestLoading(true);
    setIngestStatus(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spl_id: splId.trim() || null,
          set_id: setId.trim() || null,
          force_refresh: true // Always refresh to ensure latest analysis during development
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Ingestion failed");
      }

      const data = await res.json();
      setIngestStatus({ 
        message: `Successfully processed ${data.drug_name || 'drug label'}. Extracted adverse events from warnings, reactions, and boxed warning sections.`, 
        isError: false 
      });
      setSplId("");
      setSetId("");
      fetchDrugs(); // Refresh list
    } catch (err: any) {
      setIngestStatus({ message: err.message || "An unexpected error occurred during processing. Please verify the IDs and try again.", isError: true });
    } finally {
      setIngestLoading(false);
    }
  };

  // Search DailyMed API
  const handleDailyMedSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dmSearchQuery.trim()) {
      setDmResults([]);
      return;
    }
    setDmLoading(true);
    setIngestStatus(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/dailymed/search?q=${encodeURIComponent(dmSearchQuery.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setDmResults(data.slice(0, 5)); // Limit to top 5 results for clean layout
      }
    } catch (err) {
      console.error("DailyMed search failed:", err);
    } finally {
      setDmLoading(false);
    }
  };

  const handleIngestFromSearch = async (setIdVal: string, titleVal: string) => {
    setIngestLoading(true);
    setIngestStatus(null);
    setSetId(setIdVal);
    setSplId("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          set_id: setIdVal,
          force_refresh: true
        })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Ingestion failed");
      }
      const data = await res.json();
      setIngestStatus({ 
        message: `Successfully processed ${data.drug_name || titleVal}. Extracted adverse events.`, 
        isError: false 
      });
      setSetId("");
      fetchDrugs(); // Refresh list
      setDmResults([]); // Clear search
      setDmSearchQuery("");
    } catch (err: any) {
      setIngestStatus({ message: err.message || "An unexpected error occurred during processing. Please verify the IDs and try again.", isError: true });
    } finally {
      setIngestLoading(false);
    }
  };

  // Select suggestion chip
  const selectSuggestion = (setIdVal: string) => {
    setSetId(setIdVal);
    setSplId("");
    setIngestStatus(null);
  };

  // Execute Adverse Event search
  const executeAeSearch = async () => {
    if (!aeSearchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      let url = `${API_BASE_URL}/api/search?q=${encodeURIComponent(aeSearchQuery)}`;
      if (severityFilter) {
        url += `&severity=${encodeURIComponent(severityFilter)}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data);
      }
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setSearchLoading(false);
    }
  };

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      executeAeSearch();
    }, 300);
    return () => clearTimeout(delayDebounce);
  }, [aeSearchQuery, severityFilter]);

  // Helper function to format dates
  const formatDateString = (rawDate: string) => {
    if (!rawDate) return "Unknown";
    // Check if format is YYYYMMDD
    if (/^\d{8}$/.test(rawDate)) {
      const year = rawDate.slice(0, 4);
      const month = rawDate.slice(4, 6);
      const day = rawDate.slice(6, 8);
      return `${year}-${month}-${day}`;
    }
    return rawDate;
  };

  return (
    <div className="container">
      {/* Hero Section */}
      <section className="hero-banner glass-panel">
        <h1 className="hero-title">Adverse Event Profile Miner</h1>
        <p className="hero-desc">
          Extract, structure, and search clinical safety events directly from FDA Structured Product Labeling (SPL) XML. 
          Powered by NLP models, this tool structures warnings, precautions, postmarket findings, and clinical trial tables.
        </p>
      </section>

      {/* Main Grid */}
      <div className="dashboard-grid">
        
        {/* Left Column - Ingestion Controls */}
        <aside className="glass-panel card-padding">
          <h2 className="card-title">
            <Sparkles size={20} className="logo-highlight" />
            Ingest New Drug Label
          </h2>
          
          {/* DailyMed Search Form */}
          <div style={{ marginBottom: "20px" }}>
            <label className="form-label" style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
              <Search size={14} /> Search DailyMed Label API
            </label>
            <form onSubmit={handleDailyMedSearch} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              <input
                type="text"
                className="input-text"
                placeholder="Search generic/brand name (e.g. Advil, Lisinopril)..."
                value={dmSearchQuery}
                onChange={(e) => setDmSearchQuery(e.target.value)}
              />
              <button type="submit" className="btn btn-secondary" style={{ padding: "12px 16px" }} disabled={dmLoading}>
                Search
              </button>
            </form>
            
            {dmLoading && <div className="spinner" style={{ margin: "10px auto" }} />}
            
            {dmResults.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "rgba(9, 10, 15, 0.4)", padding: "12px", borderRadius: "8px", border: "1px solid var(--border-color)", maxHeight: "220px", overflowY: "auto", marginBottom: "12px" }}>
                {dmResults.map((result, index) => (
                  <div key={index} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem", borderBottom: index < dmResults.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none", paddingBottom: "8px", paddingTop: index > 0 ? "8px" : "0" }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "200px", color: "var(--text-primary)" }} title={result.title}>
                      {result.title}
                    </div>
                    <button 
                      onClick={() => handleIngestFromSearch(result.set_id, result.title)}
                      className="btn btn-primary"
                      style={{ padding: "6px 10px", fontSize: "0.75rem", borderRadius: "6px" }}
                      disabled={ingestLoading}
                    >
                      Ingest
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div style={{ borderTop: "1px dashed var(--border-color)", margin: "24px 0", position: "relative" }}>
            <span style={{ position: "absolute", top: "-10px", left: "50%", transform: "translateX(-50%)", background: "var(--bg-surface)", padding: "0 10px", fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              or manual UUIDs
            </span>
          </div>

          <form onSubmit={handleIngestSubmit}>
            <div className="form-group">
              <label className="form-label">Set ID (UUID)</label>
              <input
                type="text"
                className="input-text"
                placeholder="e.g. 9a667104-5835-430c-ab23-f327e584f23b"
                value={setId}
                onChange={(e) => {
                  setSetId(e.target.value);
                  if (e.target.value) setSplId(""); // mutually exclusive in state text boxes
                }}
              />
            </div>
            
            <div style={{ textAlign: 'center', margin: '12px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>— OR —</div>
            
            <div className="form-group">
              <label className="form-label">SPL Version ID (UUID)</label>
              <input
                type="text"
                className="input-text"
                placeholder="e.g. fd7b3b3a-530e-4ab8-91bd-65f05357db5c"
                value={splId}
                onChange={(e) => {
                  setSplId(e.target.value);
                  if (e.target.value) setSetId(""); // mutually exclusive in state text boxes
                }}
              />
            </div>

            {ingestStatus && (
              <div className={ingestStatus.isError ? "error-alert" : "success-alert"}>
                {ingestStatus.message}
              </div>
            )}
            
            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ width: "100%", marginTop: "10px" }}
              disabled={ingestLoading || (!splId.trim() && !setId.trim())}
            >
              {ingestLoading ? (
                <>
                  <div className="spinner" />
                  Processing XML & Extracting AEs...
                </>
              ) : (
                <>
                  <Plus size={18} />
                  Analyze Label
                </>
              )}
            </button>
          </form>

          {/* Preset Suggestions */}
          <div style={{ marginTop: "24px" }}>
            <h4 style={{ fontSize: "0.8rem", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em" }}>
              Sample Suggestions
            </h4>
            <div className="suggestions-grid">
              {sampleSuggestions.map((item, index) => (
                <button
                  key={index}
                  className="suggestion-chip"
                  onClick={() => selectSuggestion(item.setId)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Right Column - Navigation Tabs & Dynamic Content */}
        <section className="glass-panel card-padding">
          <div className="tabs-container">
            <button
              className={`tab-btn ${activeTab === "drugs" ? "active" : ""}`}
              onClick={() => setActiveTab("drugs")}
            >
              <Database size={16} style={{ marginRight: "6px", display: "inline", verticalAlign: "middle" }} />
              Ingested Labels
            </button>
            <button
              className={`tab-btn ${activeTab === "search" ? "active" : ""}`}
              onClick={() => setActiveTab("search")}
            >
              <Search size={16} style={{ marginRight: "6px", display: "inline", verticalAlign: "middle" }} />
              Query Adverse Events
            </button>
          </div>

          {/* TAB 1: Ingested Drugs List */}
          {activeTab === "drugs" && (
            <div>
              <div className="form-group" style={{ position: "relative" }}>
                <input
                  type="text"
                  className="input-text"
                  placeholder="Filter ingested labels by drug name..."
                  style={{ paddingLeft: "40px" }}
                  value={drugFilter}
                  onChange={(e) => setDrugFilter(e.target.value)}
                />
                <Search size={18} style={{ position: "absolute", left: "14px", top: "14px", color: "var(--text-muted)" }} />
              </div>

              {drugsLoading ? (
                <div className="spinner spinner-large" />
              ) : drugs.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📁</div>
                  <h3>No drug labels processed yet</h3>
                  <p style={{ color: "var(--text-muted)", marginTop: "6px" }}>Use the ingestion panel on the left to analyze drug XMLs.</p>
                </div>
              ) : (
                <div className="drug-list">
                  {drugs.map((drug) => (
                    <div 
                      key={drug.id} 
                      className="drug-item"
                      style={{ cursor: "pointer" }}
                      onClick={() => window.location.href = `/drug/${drug.spl_id}`}
                    >
                      <div className="drug-info">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
                          <div className="drug-name" style={{ margin: 0 }}>{drug.drug_name}</div>
                          {drug.status === 'pending' && <span className="badge badge-pending">Pending AI</span>}
                          {drug.status === 'extracting' && (
                            <span className="badge badge-extracting" onClick={(e) => { e.stopPropagation(); startExtraction(drug.id, drug.drug_name); }} style={{ cursor: 'pointer' }}>
                              <Loader2 size={12} className="spinner-icon-spin" /> Analyzing...
                            </span>
                          )}
                          {drug.status === 'completed' && <span className="badge badge-completed"><CheckCircle2 size={12} /> Mined</span>}
                          {drug.status === 'failed' && <span className="badge badge-failed"><XCircle size={12} /> Failed</span>}
                        </div>
                        <div className="drug-meta">
                          <span>SetID: {drug.set_id.slice(0, 8)}...</span>
                          <span>Version: {drug.version || "1"}</span>
                          <span>Published: {formatDateString(drug.published_date || "")}</span>
                        </div>
                      </div>
                      <div className="drug-action">
                        {(drug.status === 'pending' || drug.status === 'failed') && (
                          <button 
                            className="btn btn-primary-sparkle"
                            onClick={(e) => {
                              e.stopPropagation();
                              startExtraction(drug.id, drug.drug_name);
                            }}
                            style={{ padding: "6px 12px", fontSize: "0.85rem", display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <Sparkles size={14} />
                            Extract AEs
                          </button>
                        )}
                        {drug.status === 'extracting' && (
                          <button 
                            className="btn btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              startExtraction(drug.id, drug.drug_name);
                            }}
                            style={{ padding: "6px 12px", fontSize: "0.85rem", display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'var(--border-hover)' }}
                          >
                            <Loader2 size={14} className="spinner-icon-spin" />
                            Track AI
                          </button>
                        )}
                        <span className="btn btn-secondary" style={{ padding: "6px 12px", fontSize: "0.85rem" }}>
                          View Profile
                          <ArrowRight size={14} style={{ marginLeft: "4px" }} />
                        </span>
                        <button 
                          className="btn btn-danger-outline"
                          onClick={(e) => handleDeleteDrug(drug.id, e)}
                          title="Delete drug profile"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Advanced Adverse Event Search */}
          {activeTab === "search" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", marginBottom: "20px" }}>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    className="input-text"
                    placeholder="Search by Adverse Event name (e.g. headache, nausea, cardiotoxicity)..."
                    style={{ paddingLeft: "40px" }}
                    value={aeSearchQuery}
                    onChange={(e) => setAeSearchQuery(e.target.value)}
                  />
                  <Search size={18} style={{ position: "absolute", left: "14px", top: "14px", color: "var(--text-muted)" }} />
                </div>
                
                <select
                  className="input-text"
                  style={{ width: "160px", background: "rgba(9, 10, 15, 0.6)" }}
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                >
                  <option value="">All Severities</option>
                  <option value="Boxed Warning">Boxed Warning</option>
                  <option value="Severe">Severe</option>
                  <option value="Moderate">Moderate</option>
                  <option value="Mild">Mild</option>
                </select>
              </div>

              {searchLoading ? (
                <div className="spinner spinner-large" />
              ) : searchResults.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🔍</div>
                  <h3>No adverse event matches found</h3>
                  {aeSearchQuery ? (
                    <p style={{ color: "var(--text-muted)", marginTop: "6px" }}>Try searching for standard clinical terms like "headache", "rash", "hypertension", or "bleeding".</p>
                  ) : (
                    <p style={{ color: "var(--text-muted)", marginTop: "6px" }}>Type in the search field above to query AEs across all parsed labels.</p>
                  )}
                </div>
              ) : (
                <div className="search-results-list">
                  {searchResults.map((item, idx) => {
                    const sevClass = item.adverse_event.is_boxed_warning 
                      ? "boxed-warning" 
                      : (item.adverse_event.severity || "").toLowerCase();
                    return (
                      <div 
                        key={idx} 
                        className={`card card-padding search-result-card ${sevClass}`}
                        style={{ cursor: "pointer", background: "rgba(255,255,255,0.01)" }}
                        onClick={() => window.location.href = `/drug/${item.drug.spl_id}?highlight=${encodeURIComponent(item.adverse_event.ae_term)}`}
                      >
                        <div className="search-result-card-header">
                          <div className="result-ae-info">
                            <span className="result-ae-term">{item.adverse_event.ae_term}</span>
                            {item.adverse_event.original_term && item.adverse_event.original_term.toLowerCase() !== item.adverse_event.ae_term.toLowerCase() && (
                              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                                (as: "{item.adverse_event.original_term}")
                              </span>
                            )}
                            <span className={`badge badge-${sevClass}`}>
                              {item.adverse_event.is_boxed_warning ? "Boxed Warning" : item.adverse_event.severity || "Moderate"}
                            </span>
                            {item.adverse_event.frequency && item.adverse_event.frequency !== "Unknown" && (
                              <span className="badge badge-mild" style={{ background: "rgba(255,255,255,0.05)", borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
                                Freq: {item.adverse_event.frequency}
                              </span>
                            )}
                          </div>
                          <div className="result-drug-info">
                            Found on drug: <span className="result-drug-name">{item.drug.drug_name}</span>
                          </div>
                        </div>
                        {item.adverse_event.raw_context && (
                          <FormattedContext 
                            text={item.adverse_event.raw_context}
                            term={item.adverse_event.original_term || item.adverse_event.ae_term}
                            severity={item.adverse_event.severity}
                            isBoxedWarning={item.adverse_event.is_boxed_warning}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </section>
      </div>

      {/* AI Extraction Progress Modal */}
      {isModalOpen && activeExtractingDrug && (
        <div className="modal-backdrop" onClick={closeExtractionModal}>
          <div className="modal-container glass-panel card-padding" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={20} className="logo-highlight" />
                <h2 style={{ fontSize: '1.25rem' }}>AI Adverse Event Miner</h2>
              </div>
              <button className="btn-close" onClick={closeExtractionModal}>
                <X size={18} />
              </button>
            </div>
            
            <div className="modal-body" style={{ marginTop: '20px' }}>
              <div style={{ marginBottom: '20px', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Target Label
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px' }}>
                  {activeExtractingDrug.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', fontSize: '0.9rem' }}>
                  {extractionStatus === 'running' && (
                    <>
                      <Loader2 size={16} className="spinner-icon-spin" style={{ color: 'var(--primary)' }} />
                      <span style={{ color: 'var(--text-secondary)' }}>{overallMessage}</span>
                    </>
                  )}
                  {extractionStatus === 'success' && (
                    <>
                      <CheckCircle2 size={16} style={{ color: 'var(--color-mild)' }} />
                      <span style={{ color: 'var(--color-mild)', fontWeight: 600 }}>{overallMessage}</span>
                    </>
                  )}
                  {extractionStatus === 'failed' && (
                    <>
                      <XCircle size={16} style={{ color: 'var(--color-boxed-warning)' }} />
                      <span style={{ color: 'var(--color-boxed-warning)', fontWeight: 600 }}>{overallMessage}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Progress bar visual */}
              <div style={{ height: '4px', width: '100%', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden', marginBottom: '20px' }}>
                <div 
                  style={{ 
                    height: '100%', 
                    background: extractionStatus === 'success' 
                      ? 'var(--color-mild)' 
                      : extractionStatus === 'failed' 
                        ? 'var(--color-boxed-warning)' 
                        : 'linear-gradient(90deg, var(--primary), var(--accent))',
                    width: extractionStatus === 'success' ? '100%' : extractionStatus === 'failed' ? '100%' : '50%',
                    transition: 'width 0.5s ease',
                    animation: extractionStatus === 'running' ? 'pulse-glow 2s infinite' : 'none'
                  }} 
                />
              </div>

              <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '10px' }}>
                Extraction Stream Log
              </h3>
              
              <div className="extraction-log-list">
                {extractionLog.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Initializing model and waiting for first section stream...
                  </div>
                ) : (
                  extractionLog.map((log, index) => (
                    <div key={index} className={`extraction-log-item ${log.status}`}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {log.status === 'processing' && (
                          <Loader2 size={14} className="spinner-icon-spin" style={{ color: 'var(--primary)' }} />
                        )}
                        {log.status === 'done' && (
                          <CheckCircle2 size={14} style={{ color: 'var(--color-mild)' }} />
                        )}
                        {log.status === 'failed' && (
                          <XCircle size={14} style={{ color: 'var(--color-boxed-warning)' }} />
                        )}
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{log.section_title}</span>
                      </div>
                      <span style={{ fontSize: '0.85rem', color: log.status === 'done' ? 'var(--color-mild)' : log.status === 'failed' ? 'var(--color-boxed-warning)' : 'var(--text-secondary)' }}>
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="modal-footer" style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              {extractionStatus === 'running' && (
                <button className="btn btn-secondary" onClick={closeExtractionModal}>
                  Run in Background
                </button>
              )}
              {(extractionStatus === 'success' || extractionStatus === 'failed') && (
                <button className="btn btn-primary" onClick={closeExtractionModal}>
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="container" style={{ paddingTop: "100px", textAlign: "center" }}><div className="spinner spinner-large" /></div>}>
      <DashboardContent />
    </Suspense>
  );
}
