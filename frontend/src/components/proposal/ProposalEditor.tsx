import type { FormEvent, ReactNode } from 'react';

interface ProposalEditorProps {
  text: string;
  loading: boolean;
  onTextChange: (text: string) => void;
  onLoadExample: () => void;
  onSubmit: (event: FormEvent) => void;
  submitDisabled?: boolean;
  belowEditor?: ReactNode;
}

export default function ProposalEditor({ text, loading, onTextChange, onLoadExample, onSubmit, submitDisabled, belowEditor }: ProposalEditorProps) {
  return (
    <form onSubmit={onSubmit}>
      <textarea
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="이곳에 이메일, 메신저 또는 문서의 외주 제안 내용을 붙여넣으세요."
        maxLength={20000}
        required
        className="editor"
      />
      {belowEditor}
      <div className="editor-footer">
        <button className="btn btn-secondary" type="button" onClick={onLoadExample}>예시 불러오기</button>
        <div className="action-row"><span className="helper">{text.length.toLocaleString()} / 20,000자</span><button className="btn btn-primary" type="submit" disabled={loading || !text.trim() || submitDisabled}>{loading ? '분석 중…' : '분석 미리보기'}</button>
        </div>
      </div>
    </form>
  );
}
