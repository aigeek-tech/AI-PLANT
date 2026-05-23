import { useMemo, useState } from 'react';

interface PluginPageOutletProps {
  pluginId: string;
  entry: string;
  element: string;
}

export function PluginPageOutlet({ pluginId, entry, element }: PluginPageOutletProps) {
  const [isLoading, setIsLoading] = useState(true);
  const srcDoc = useMemo(() => buildPluginFrameDocument(entry, element), [element, entry]);

  return (
    <div className="relative min-h-[calc(100vh-7rem)]">
      {isLoading ? <div className="absolute inset-x-0 top-0 p-6 text-sm font-semibold text-slate-500">正在加载插件...</div> : null}
      <iframe
        key={`${pluginId}:${entry}:${element}:${window.location.pathname}${window.location.search}`}
        title={`${pluginId} plugin`}
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
        className="min-h-[calc(100vh-7rem)] w-full border-0"
        onLoad={() => setIsLoading(false)}
      />
    </div>
  );
}

function buildPluginFrameDocument(entry: string, element: string) {
  const cssUrl = entry.replace(/\.m?js(?:\?.*)?$/i, '.css');
  const location = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base target="_parent" />
    <link rel="stylesheet" href="${escapeHtmlAttribute(cssUrl)}" />
    <style>
      html, body { min-height: 100%; margin: 0; background: transparent; }
      body { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    </style>
  </head>
  <body>
    <script type="module">
      import ${JSON.stringify(entry)};
      const mount = document.createElement(${JSON.stringify(element)});
      mount.dataset.pluginLocation = ${JSON.stringify(location)};
      document.body.appendChild(mount);
    </script>
  </body>
</html>`;
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
