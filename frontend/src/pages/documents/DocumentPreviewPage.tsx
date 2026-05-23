import React, { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { DocumentPreviewPanel } from '../../components/documents/DocumentPreviewDialog';
import { secondaryButtonClass } from '../../components/ui/buttonStyles';

export function DocumentPreviewPage() {
  const { projectId, documentId, revisionId, fileId } = useParams();
  const projectPath = useMemo(() => (projectId ? `/projects/${projectId}` : '/projects'), [projectId]);

  return (
    <DocumentPreviewPanel
      projectId={projectId}
      documentId={documentId}
      revisionId={revisionId}
      fileId={fileId}
      leadingAction={(
        <Link to={projectPath} className={secondaryButtonClass}>
          <ArrowLeft className="h-4 w-4" />
          返回项目
        </Link>
      )}
    />
  );
}
