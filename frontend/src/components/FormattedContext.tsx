import React from "react";

interface FormattedContextProps {
  text: string;
  term: string;
  severity?: string;
  isBoxedWarning?: boolean;
}

export default function FormattedContext({ text, term, severity, isBoxedWarning }: FormattedContextProps) {
  if (!text) return null;

  const highlight = (str: string) => {
    if (!term || !str) return str;
    const escapedTerm = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedTerm})`, "gi");
    const parts = str.split(regex);
    return parts.map((part, idx) => 
      regex.test(part) ? (
        <mark key={idx} style={{ 
          backgroundColor: isBoxedWarning ? 'rgba(255, 107, 107, 0.3)' : 'rgba(74, 144, 226, 0.3)',
          color: 'var(--text-primary)',
          borderRadius: '2px',
          padding: '0 2px'
        }}>
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  
  let currentTableRows: React.ReactNode[] = [];
  let currentListItems: React.ReactNode[] = [];

  const flushTable = () => {
    if (currentTableRows.length > 0) {
      elements.push(
        <div className="table-responsive" key={`table-${elements.length}`} style={{ margin: "8px 0", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85em", border: "1px solid var(--border-color)" }}>
            <tbody>{currentTableRows}</tbody>
          </table>
        </div>
      );
      currentTableRows = [];
    }
  };

  const flushList = () => {
    if (currentListItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} style={{ margin: "8px 0", paddingLeft: "20px", fontSize: "0.9em" }}>
          {currentListItems}
        </ul>
      );
      currentListItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line === '') {
      flushTable();
      flushList();
      continue;
    }

    if (line.includes(' | ')) {
      flushList();
      const cells = line.split(' | ').filter((c, idx, arr) => {
        // filter out trailing empty splits caused by ending pipe
        if (idx === arr.length - 1 && c.trim() === '') return false;
        return true;
      });
      
      currentTableRows.push(
        <tr key={i} style={{ borderBottom: "1px solid var(--border-color)" }}>
          {cells.map((cell, cIdx) => (
            <td key={cIdx} style={{ padding: "6px", borderRight: "1px solid var(--border-color)" }}>
              {highlight(cell.trim())}
            </td>
          ))}
        </tr>
      );
    } else if (line.startsWith('- ')) {
      flushTable();
      currentListItems.push(
        <li key={i}>{highlight(line.substring(2))}</li>
      );
    } else {
      flushTable();
      flushList();
      elements.push(
        <p key={i} style={{ margin: "4px 0", fontSize: "0.9em", whiteSpace: "pre-wrap" }}>
          {highlight(line)}
        </p>
      );
    }
  }
  
  flushTable();
  flushList();

  return (
    <div className={`formatted-context-wrapper ${isBoxedWarning ? 'boxed-warning-context' : ''}`} style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid var(--border-color)',
      borderLeft: `3px solid ${isBoxedWarning ? 'var(--danger)' : 'var(--primary)'}`,
      padding: '12px',
      borderRadius: '4px',
      marginTop: '8px',
      color: 'var(--text-secondary)'
    }}>
      {elements}
    </div>
  );
}
