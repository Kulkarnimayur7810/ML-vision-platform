"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** react-markdown never renders raw HTML and strips unsafe URLs (javascript:), so user-written docs can't inject script. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="max-w-none text-[14px] leading-relaxed text-fg">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        h1: (p) => <h1 className="mb-3 mt-6 text-2xl font-semibold first:mt-0" {...p} />,
        h2: (p) => <h2 className="mb-2 mt-6 text-lg font-semibold" {...p} />,
        h3: (p) => <h3 className="mb-1.5 mt-4 text-base font-semibold" {...p} />,
        p: (p) => <p className="my-2" {...p} />,
        ul: (p) => <ul className="my-2 list-disc pl-6" {...p} />,
        ol: (p) => <ol className="my-2 list-decimal pl-6" {...p} />,
        li: (p) => <li className="my-0.5" {...p} />,
        a: ({ href, ...p }) => <a className="text-accent underline" href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer nofollow" {...p} />,
        code: (p) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12.5px]" {...p} />,
        pre: (p) => <pre className="my-3 overflow-x-auto rounded-lg border border-line bg-subtle p-3 font-mono text-xs" {...p} />,
        blockquote: (p) => <blockquote className="my-3 border-l-4 border-line-strong pl-3 text-fg-muted" {...p} />,
        table: (p) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-[13px]" {...p} /></div>,
        th: (p) => <th className="border border-line bg-subtle px-2 py-1 text-left font-medium" {...p} />,
        td: (p) => <td className="border border-line px-2 py-1" {...p} />,
        hr: () => <hr className="my-4 border-line" />,
        input: (p) => <input {...p} disabled className="mr-1.5 align-middle" />,
      }}>{children}</ReactMarkdown>
    </div>
  );
}
