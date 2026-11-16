using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using UIAutomationClient;
using Microsoft.Win32;

// 只操作 CodeAI 中已识别的控件，不使用剪贴板、全局按键或固定坐标。
internal static class CodeaiNavigation
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly IUIAutomation Automation = new CUIAutomation();
    private const int Button = 50000, Edit = 50004, ListItem = 50007, TextType = 50020, Document = 50030;
    private delegate bool WindowCallback(IntPtr handle, IntPtr arg);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr arg);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("iphlpapi.dll")] private static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int family, int tableClass, uint reserved);

    [STAThread]
    public static void Main()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            var input = Json.Deserialize<Dictionary<string, object>>(Console.In.ReadToEnd());
            string action = Text(input, "action");
            if (action == "windows")
            {
                var windows = Windows();
                if (windows.Count == 0)
                {
                    string exe = Executable();
                    if (exe != null)
                    {
                        Process.Start(new ProcessStartInfo(exe) { UseShellExecute = false });
                        Wait(() => (windows = Windows()).Count > 0, 10000);
                    }
                }
                var result = new List<object>();
                var ports = Ports();
                foreach (var handle in windows)
                {
                    var document = Root(handle).FindFirst(TreeScope.TreeScope_Descendants, Automation.CreatePropertyCondition(30003, Document));
                    string url = Value(document);
                    if (!string.IsNullOrEmpty(url)) result.Add(new { handle = handle.ToInt64().ToString(), url = url });
                    else if (ports.Length > 0) foreach (int port in ports) result.Add(new { handle = handle.ToInt64().ToString(), url = "http://127.0.0.1:" + port });
                    else result.Add(new { handle = handle.ToInt64().ToString(), url = "" });
                }
                Write(new { windows = result });
                return;
            }
            IntPtr target = new IntPtr(long.Parse(Text(input, "handle")));
            if (!Windows().Contains(target)) throw new InvalidOperationException("CodeAI 窗口已关闭");
            if (IsIconic(target)) ShowWindow(target, 9);
            SetForegroundWindow(target);
            bool focused = Wait(() => GetForegroundWindow() == target, 1000);
            if (action == "focus" || !focused)
            {
                Write(new { opened = false, focused = focused });
                return;
            }
            if (action != "open") throw new InvalidOperationException("未知导航操作");
            string title = Text(input, "title"), query = Text(input, "query");
            var markers = ((System.Collections.IEnumerable)input["markers"]).Cast<object>().Select(value =>
                Automation.CreatePropertyCondition(30011, Convert.ToString(value))).ToArray();
            IUIAutomationCondition content = markers.Length == 0 ? null : markers.Aggregate((left, right) => Automation.CreateOrCondition(left, right));
            var fingerprints = ((System.Collections.IEnumerable)input["fingerprints"]).Cast<object>().Select(value => Clean(Convert.ToString(value))).Where(value => value.Length >= 8).ToArray();
            var root = Root(target);
            var search = Search(root);
            if (search == null)
            {
                var history = Elements(root, Button).FirstOrDefault(e => Named(e, "历史会话", "History"));
                if (history != null) Invoke(history);
                Wait(() => (search = Search(Root(target))) != null, 2000);
            }
            if (search == null) throw new InvalidOperationException("未找到历史会话搜索框");
            string previous = Value(search);
            SetValue(search, query);
            IUIAutomationElement row = null;
            // 在两个项目范围内查找；匹配完整标题，歧义时不点击。
            foreach (string scope in new[] { "current", "others" })
            {
                root = Root(target);
                search = Search(root);
                var sidebar = Automation.ControlViewWalker.GetParentElement(search);
                var tab = Elements(sidebar, Button).FirstOrDefault(e => scope == "current"
                    ? Starts(e, "当前项目", "Current project") : Starts(e, "其他项目", "Other projects"));
                if (tab != null) Invoke(tab);
                Thread.Sleep(300);
                sidebar = Automation.ControlViewWalker.GetParentElement(Search(Root(target)));
                foreach (var group in Elements(sidebar, Button).Where(e => e.CurrentName.TrimStart().StartsWith("▸")).ToArray()) Invoke(group);
                Wait(() =>
                {
                    var area = Automation.ControlViewWalker.GetParentElement(Search(Root(target)));
                    var rows = Elements(area, ListItem).Where(e => Elements(e, TextType).Any(t => Clean(t.CurrentName) == Clean(title))).ToArray();
                    if (rows.Length > 1) throw new InvalidOperationException("找到多条同名会话");
                    row = rows.SingleOrDefault();
                    return row != null;
                }, 1500);
                if (row != null) break;
            }
            if (row == null) throw new InvalidOperationException("历史列表中未找到目标会话");
            Invoke(row);
            bool opened = Wait(() =>
            {
                var current = Root(target);
                if (content != null && current.FindFirst(TreeScope.TreeScope_Descendants, content) != null) return true;
                var messages = current.FindFirst(TreeScope.TreeScope_Descendants, Automation.CreatePropertyCondition(30005, "消息列表"))
                    ?? current.FindFirst(TreeScope.TreeScope_Descendants, Automation.CreatePropertyCondition(30005, "Message list"));
                return messages != null && Elements(messages, TextType).Any(text => fingerprints.Any(part => Clean(text.CurrentName).Contains(part)));
            }, 5000);
            if (opened)
            {
                search = Search(Root(target));
                if (search != null) SetValue(search, previous);
            }
            Write(new { opened = opened, focused = focused });
        }
        catch (Exception error) { Write(new { opened = false, error = error.Message }); }
    }

    private static string Text(Dictionary<string, object> input, string key) { return input.ContainsKey(key) ? Convert.ToString(input[key]) : ""; }
    private static void Write(object value) { Console.WriteLine(Json.Serialize(value)); }
    private static string Clean(string value) { return System.Text.RegularExpressions.Regex.Replace(value ?? "", @"\s+", " ").Trim(); }
    private static bool Wait(Func<bool> condition, int timeout)
    {
        var timer = Stopwatch.StartNew();
        do { if (condition()) return true; Thread.Sleep(120); } while (timer.ElapsedMilliseconds < timeout);
        return false;
    }
    private static IUIAutomationElement Root(IntPtr handle) { return Automation.ElementFromHandle(handle); }
    private static IEnumerable<IUIAutomationElement> Elements(IUIAutomationElement root, int type)
    {
        var elements = root.FindAll(TreeScope.TreeScope_Descendants, Automation.CreatePropertyCondition(30003, type));
        for (int i = 0; i < elements.Length; i++) yield return elements.GetElement(i);
    }
    private static bool Named(IUIAutomationElement element, params string[] names) { return names.Any(n => element.CurrentName.Equals(n, StringComparison.OrdinalIgnoreCase)); }
    private static bool Starts(IUIAutomationElement element, params string[] names) { return names.Any(n => element.CurrentName.StartsWith(n, StringComparison.OrdinalIgnoreCase)); }
    private static IUIAutomationElement Search(IUIAutomationElement root)
    {
        return Elements(root, Edit).FirstOrDefault(e => e.CurrentIsOffscreen == 0 && Starts(e, "搜索会话", "Search sessions", "Search conversations"));
    }
    private static object Pattern(IUIAutomationElement element, int id)
    {
        try { return element == null ? null : element.GetCurrentPattern(id); } catch (COMException) { return null; }
    }
    private static string Value(IUIAutomationElement element)
    {
        var value = Pattern(element, 10002) as IUIAutomationValuePattern;
        if (value != null) return value.CurrentValue;
        var legacy = Pattern(element, 10018) as IUIAutomationLegacyIAccessiblePattern;
        return legacy == null ? "" : legacy.CurrentValue;
    }
    private static void SetValue(IUIAutomationElement element, string value) { ((IUIAutomationValuePattern)element.GetCurrentPattern(10002)).SetValue(value); }
    private static void Invoke(IUIAutomationElement element)
    {
        var invoke = Pattern(element, 10000) as IUIAutomationInvokePattern;
        if (invoke != null) { invoke.Invoke(); return; }
        var legacy = Pattern(element, 10018) as IUIAutomationLegacyIAccessiblePattern;
        if (legacy != null && !string.IsNullOrEmpty(legacy.CurrentDefaultAction)) { legacy.DoDefaultAction(); return; }
        throw new InvalidOperationException("该 CodeAI 控件不支持自动打开，请手动选择");
    }
    private static List<IntPtr> Windows()
    {
        var pids = new HashSet<int>(Process.GetProcessesByName("CodeAI").Select(p => p.Id));
        var windows = new List<IntPtr>();
        EnumWindows((handle, arg) =>
        {
            uint pid; GetWindowThreadProcessId(handle, out pid);
            if (pids.Contains((int)pid) && IsWindowVisible(handle)) windows.Add(handle);
            return true;
        }, IntPtr.Zero);
        return windows;
    }
    // 部分 Chromium 版本不通过 ValuePattern 提供文档 URL，改读 CodeAI 自己的监听端口。
    private static int[] Ports()
    {
        var pids = new HashSet<int>(Process.GetProcessesByName("CodeAI").Select(p => p.Id));
        int size = 0;
        GetExtendedTcpTable(IntPtr.Zero, ref size, false, 2, 5, 0);
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            if (GetExtendedTcpTable(buffer, ref size, false, 2, 5, 0) != 0) return new int[0];
            var ports = new List<int>();
            for (int i = 0, count = Marshal.ReadInt32(buffer); i < count; i++)
            {
                int offset = 4 + i * 24;
                if (Marshal.ReadInt32(buffer, offset) != 2 || !pids.Contains(Marshal.ReadInt32(buffer, offset + 20))) continue;
                int value = Marshal.ReadInt32(buffer, offset + 8);
                ports.Add(((value & 255) << 8) | ((value >> 8) & 255));
            }
            return ports.Distinct().ToArray();
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static string Executable()
    {
        foreach (var registry in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            using (var key = registry.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\CodeAI.exe"))
            {
                string candidate = key == null ? null : key.GetValue("") as string;
                if (!string.IsNullOrEmpty(candidate) && File.Exists(candidate)) return candidate;
            }
            using (var uninstall = registry.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
            {
                if (uninstall == null) continue;
                foreach (string name in uninstall.GetSubKeyNames()) using (var entry = uninstall.OpenSubKey(name))
                {
                    if (entry == null || !string.Equals(entry.GetValue("DisplayName") as string, "CodeAI", StringComparison.OrdinalIgnoreCase)) continue;
                    string directory = entry.GetValue("InstallLocation") as string;
                    if (!string.IsNullOrEmpty(directory) && File.Exists(Path.Combine(directory, "CodeAI.exe"))) return Path.Combine(directory, "CodeAI.exe");
                }
            }
        }
        string standard = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "CodeAI", "CodeAI.exe");
        return File.Exists(standard) ? standard : null;
    }
}
