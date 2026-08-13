export default function TextRenderer({ content }: { content: string }) {
  return (
    <pre className="max-w-3xl whitespace-pre-wrap font-mono text-sm leading-relaxed text-zinc-200">
      {content}
    </pre>
  );
}
