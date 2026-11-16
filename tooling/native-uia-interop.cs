using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

// 在构建机生成 Windows UIA COM 的互操作程序集，不要求目标电脑安装 SDK。
class NativeUiaInterop : ITypeLibImporterNotifySink
{
    [DllImport("oleaut32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void LoadTypeLibEx(string file, int kind, out ITypeLib library);
    static void Main(string[] args)
    {
        ITypeLib library;
        LoadTypeLibEx(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "UIAutomationCore.dll"), 2, out library);
        var assembly = new TypeLibConverter().ConvertTypeLibToAssembly(library, args[0], TypeLibImporterFlags.None, new NativeUiaInterop(), null, null, "UIAutomationClient", null);
        assembly.Save(Path.GetFileName(args[0]));
    }
    public Assembly ResolveRef(object library) { return null; }
    public void ReportEvent(ImporterEventKind kind, int code, string message) { }
}
