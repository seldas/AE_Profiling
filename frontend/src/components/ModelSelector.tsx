"use client";

import React, { useState, useEffect } from "react";

export default function ModelSelector() {
  const [provider, setProvider] = useState<string>("");

  useEffect(() => {
    const initProvider = async () => {
      const saved = localStorage.getItem("llm_provider");
      if (saved) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setProvider(saved);
      } else {
        try {
          const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
          const res = await fetch(`${API_BASE_URL}/api/config`);
          if (res.ok) {
            const data = await res.json();
            const defaultProvider = data.llm_provider || "gemini";
            setProvider(defaultProvider);
            localStorage.setItem("llm_provider", defaultProvider);
          } else {
            setProvider("gemini");
            localStorage.setItem("llm_provider", "gemini");
          }
        } catch (err) {
          console.error("Failed to load config", err);
          setProvider("gemini");
          localStorage.setItem("llm_provider", "gemini");
        }
      }
    };
    initProvider();
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
        <option value="gemini">Google Gemini</option>
        <option value="vllm">vLLM</option>
        <option value="openai">OpenAI</option>
        <option value="ollama">Ollama (Local)</option>
      </select>
    </div>
  );
}
