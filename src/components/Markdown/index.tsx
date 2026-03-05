import React from "react";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PluggableList } from "unified";
import remarkMath from "remark-math";
import { getResponseSettings } from "@/lib";

// Extend default remark plugins with remark-math (singleDollarTextMath enabled for LLM output).
const customRemarkPlugins: PluggableList = [
  ...Object.values(defaultRemarkPlugins),
  [remarkMath, { singleDollarTextMath: true }],
];

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

/**
 * Strip or style `<think>` tags from reasoning models (e.g., DeepSeek R1).
 * When visible, renders as a "Thought Process" section with a separator.
 * When hidden, removes the thinking content entirely.
 */
function processReasoningTags(content: string, showThinking: boolean): string {
  if (showThinking) {
    return content
      .replace(/<think>/g, "\n_**Thought Process:**_\n\n")
      .replace(/<\/think>/g, "\n\n---\n\n");
  }
  return content.replace(/<think>[\s\S]*?<\/think>/g, "");
}

// Streamdown handles HTML sanitization internally via rehype-sanitize (GitHub schema).
// Script tags, event handlers, and javascript: URLs are all stripped — no additional XSS protection needed.
export function Markdown({
  children,
  isStreaming = false,
}: MarkdownRendererProps) {
  const { showThinking } = getResponseSettings();

  const processedContent = React.useMemo(
    () => processReasoningTags(children, showThinking),
    [children, showThinking]
  );

  return (
    <Streamdown
      isAnimating={isStreaming}
      shikiTheme={["github-light", "github-dark"]}
      remarkPlugins={customRemarkPlugins}
      components={COMPONENTS as any}
      controls={{
        table: true,
        code: true,
        mermaid: {
          download: true,
          copy: true,
          fullscreen: false,
          panZoom: false,
        },
      }}
    >
      {processedContent}
    </Streamdown>
  );
}

const COMPONENTS = {
  a: ({ children, href, ...props }: any) => {
    const handleClick = async (e: React.MouseEvent) => {
      e.preventDefault();
      if (href) {
        try {
          await openUrl(href);
        } catch (error) {
          console.error("Failed to open URL:", error);
        }
      }
    };

    return (
      <a
        href={href}
        className="text-gray-600 underline underline-offset-2 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100 cursor-pointer"
        onClick={handleClick}
        {...props}
      >
        {children}
      </a>
    );
  },
};
