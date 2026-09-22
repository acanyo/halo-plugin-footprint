export interface CommentNextComposerOwner {
  displayName: string;
  email: string;
  website?: string;
}

export interface CommentNextComposerSubmitPayload {
  content: string;
  hidden: boolean;
  captchaCode: string;
  owner?: CommentNextComposerOwner;
}
