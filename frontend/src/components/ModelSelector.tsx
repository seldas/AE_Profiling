"use client";

import React, { useState, useEffect } from "react";

export default function ModelSelector() {
  const [provider, setProvider] = useState<string>("");

  useEffect(() => {
    // Load from localStorage on mount
    const saved = localStorage.getItem("llm_provider");
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProvider(saved);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setProvider(val);
    if (val) {
      localStorage.setItem("llm_provider", val);
    } else {
      localStorage.removeItem("llm_provider");
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "12px" }}>
      <label htmlFor="model-select" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
        Model:
      </label>
      <select 
        id="model-select"
        value={provider} 
        onChange={handleChange}
        style={{
          background: "rgba(22, 26, 43, 0.6)",
          color: "var(--text-primary)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          padding: "4px 8px",
          borderRadius: "6px",
          fontSize: "0.85rem",
          cursor: "pointer",
          outline: "none"
        }}
      >
        <option value="">Default (Server Config)</option>
        <option value="gemini">Google Gemini</option>
        <option value="vllm">vLLM</option>
        <option value="openai">OpenAI</option>
        <option value="ollama">Ollama (Local)</option>
      </select>
    </div>
  );
}
