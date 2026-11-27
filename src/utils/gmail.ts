import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { NotificationItem, UserProfile } from '../types';

function encodeUtf8Base64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeMimeHeader(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

export async function sendGmailMessage(
  accessToken: string,
  toEmail: string,
  subject: string,
  bodyText: string
): Promise<{ success: boolean; error?: string }> {
  const rawMessage = [
    `To: ${toEmail}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(bodyText))),
  ].join('\r\n');

  const raw = encodeUtf8Base64Url(rawMessage);

  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    }
  );

  if (!response.ok) {
    const errPayload = await response.json().catch(() => ({}));
    return {
      success: false,
      error:
        errPayload?.error?.message ||
        `Gmail API error (${response.status})`,
    };
  }
  return { success: true };
}

export async function createInAppNotification(params: {
  recipientUserId?: string;
  recipientEmail: string;
  title: string;
  message: string;
  category: NotificationItem['category'];
  emailSent: boolean;
  sender: UserProfile;
}) {
  try {
    await addDoc(collection(db, 'notifications'), {
      recipientUserId: params.recipientUserId || '',
      recipientEmail: params.recipientEmail,
      title: params.title.slice(0, 160),
      message: params.message.slice(0, 600),
      category: params.category,
      isRead: false,
      emailSent: params.emailSent,
      senderId: params.sender.uid,
      senderName: params.sender.displayName.slice(0, 120),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'notifications');
  }
}
