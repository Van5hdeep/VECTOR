import { execFile } from "node:child_process";

// Windows PowerShell's registered AppUserModelID, so toasts work without installing anything
const TOAST_APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

const TOAST_SCRIPT = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $xml.GetElementsByTagName('text')
$texts.Item(0).AppendChild($xml.CreateTextNode($env:VECTOR_TOAST_TITLE)) > $null
$texts.Item(1).AppendChild($xml.CreateTextNode($env:VECTOR_TOAST_BODY)) > $null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:VECTOR_TOAST_APP).Show($toast)
`;

/** Shows a Windows toast notification. Text is passed via env vars, never as code. */
export function showToast(title: string, body: string): void {
  if (process.platform !== "win32") return;
  execFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", TOAST_SCRIPT],
    {
      env: { ...process.env, VECTOR_TOAST_TITLE: title, VECTOR_TOAST_BODY: body, VECTOR_TOAST_APP: TOAST_APP_ID },
      timeout: 15_000,
      windowsHide: true,
    },
    (err) => {
      if (err) console.error("[VECTOR_NOTIFY] Toast failed:", err.message);
    }
  );
}
