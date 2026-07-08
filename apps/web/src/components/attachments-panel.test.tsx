import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AttachmentsPanel } from './attachments-panel';

const listAttachments = vi.fn();
const uploadAttachment = vi.fn();
const deleteAttachment = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    listAttachments: (...a: unknown[]) => listAttachments(...a),
    uploadAttachment: (...a: unknown[]) => uploadAttachment(...a),
    deleteAttachment: (...a: unknown[]) => deleteAttachment(...a),
  },
  apiUrl: (path: string) => `http://localhost:8787${path}`,
}));

beforeEach(() => {
  listAttachments.mockReset().mockResolvedValue([
    {
      id: 'a1',
      taskId: 't',
      filename: 'note.txt',
      path: '',
      mime: 'text/plain',
      size: 5,
      createdAt: '',
    },
  ]);
  uploadAttachment.mockReset().mockResolvedValue({
    id: 'a2',
    taskId: 't',
    filename: 'new.txt',
    path: '',
    mime: 'text/plain',
    size: 3,
    createdAt: '',
  });
  deleteAttachment.mockReset().mockResolvedValue(undefined);
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('AttachmentsPanel', () => {
  it('lists existing attachments with a download link', async () => {
    wrap(<AttachmentsPanel taskId="t" />);
    const link = (await screen.findByRole('link', { name: /note\.txt/i })) as HTMLAnchorElement;
    expect(link.href).toContain('/attachments/a1');
  });

  it('uploading a file calls uploadAttachment with the task id and file', async () => {
    const user = userEvent.setup();
    wrap(<AttachmentsPanel taskId="t" />);
    await screen.findByRole('link', { name: /note\.txt/i });

    const file = new File(['hi'], 'hi.txt', { type: 'text/plain' });
    const input = screen.getByLabelText(/add attachment/i, { selector: 'input' });
    await user.upload(input, file);

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith('t', file));
  });

  it('deleting an attachment calls deleteAttachment with its id', async () => {
    const user = userEvent.setup();
    wrap(<AttachmentsPanel taskId="t" />);
    const deleteBtn = await screen.findByRole('button', { name: /delete note\.txt/i });
    await user.click(deleteBtn);
    expect(deleteAttachment).toHaveBeenCalledWith('a1');
  });
});
