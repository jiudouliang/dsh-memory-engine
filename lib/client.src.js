window.__ModuleLoader__.load({
  id: "dsh-memory-engine",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var ReactDOM = require("react-dom");
    // 2026-10-30：从 views.actions 挪到 header.actions。
    // views.actions 是「更多视图」下拉菜单的行（Chat/Trajectory 旁边的 ⋯），
    // 注册进去只是菜单里多一行，看不见；header.actions 才是头部正常按钮区。
    var SLOT_NAME = "conversation.session.header.actions";
    // 不同 DSH 版本暴露的插槽名不一样：新版本用 header.actions，
    // 老版本没有这个槽时退回 views.actions（会出现在「更多视图」菜单里，虽然不显眼但能用）。
    var SLOT_FALLBACKS = ["conversation.session.header.actions", "conversation.session.header.views.actions"];

    /* __CANVAS_RENDERER__ */
    /* __GRAPH_LAYOUT__ */

    var defaultSettings = { hideButton: false, showGuideOnEmpty: true, graphTheme: "classic", graphLayout: "sphere", autoMemory: { enabled: false, maxPerTurn: 2, dailyCap: 40 }, showAutoMemoryCostHint: true };
    var actionStyle = { padding: "7px 12px", borderRadius: "8px", border: "1px solid var(--memory-border,#6999b8)", background: "var(--memory-button,#102236)", color: "var(--memory-text,#e2f4ff)", font: "inherit", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 };
    var closeStyle = Object.assign({}, actionStyle, { padding: "11px 20px", minHeight: "42px", fontWeight: 700, letterSpacing: "0.02em" });
        var fieldStyle = { boxSizing: "border-box", padding: "10px 12px", borderRadius: "8px", border: "1px solid #35536b", background: "#091422", color: "#e2f4ff", font: "inherit", minWidth: 0 };
    var kinds = ["知识", "印象", "对话", "事件", "日记"];
    var appearanceOptions = [
      { key: "graphTheme", label: "配色", choices: [["classic", "经典星空"], ["neon", "赛博霓虹"], ["paper", "铅绘素描"], ["mono", "极简单色"]] },
      { key: "graphLayout", label: "布局", choices: [["sphere", "球体"], ["galaxy", "星系"], ["brain", "大脑神经网络"]] },
    ];
    var appearanceStyles = {
      classic: {},
      neon: { "--memory-text": "#f4dfff", "--memory-muted": "#ba9aca", "--memory-accent": "#ff9de1", "--memory-border": "#704580", "--memory-panel": "#170d21ee", "--memory-button": "#271333", "--memory-shadow": "none" },
      paper: { "--memory-text": "#303030", "--memory-muted": "#72716d", "--memory-accent": "#404040", "--memory-border": "#b5b1a9", "--memory-panel": "#f7f5f0f2", "--memory-button": "#eeece6", "--memory-shadow": "none" },
      mono: { "--memory-text": "#eeeeee", "--memory-muted": "#aaaaaa", "--memory-accent": "#eeeeee", "--memory-border": "#666666", "--memory-panel": "#171717ee", "--memory-button": "#252525", "--memory-shadow": "none" },
    };

    function AppearanceControls(props) {
      return React.createElement("section", { "aria-label": "图谱外观", "data-memory-engine-appearance-options": props.location,
        style: { color: "var(--memory-text,#dbeaf8)", font: "14px/1.7 system-ui,sans-serif" } },
        appearanceOptions.map(function (group) {
          return React.createElement("fieldset", { key: group.key, disabled: props.busy, style: { border: 0, margin: "0 0 14px", padding: 0 } },
            React.createElement("legend", { style: { marginBottom: "8px", color: "var(--memory-muted,#9fb7ce)" } }, group.label),
            React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px 14px" } }, group.choices.map(function (choice) {
              return React.createElement("label", { key: choice[0], style: { display: "inline-flex", alignItems: "center", gap: "6px", cursor: props.busy ? "wait" : "pointer" } },
                React.createElement("input", { type: "radio", name: "memory-" + props.location + "-" + group.key, value: choice[0],
                  "data-memory-engine-appearance-choice": group.key + ":" + choice[0],
                  checked: props.settings[group.key] === choice[0], style: { margin: 0, accentColor: "var(--memory-accent,#a4e6ff)" },
                  onChange: function () { var changes = {}; changes[group.key] = choice[0]; props.onChange(changes); } }), choice[1]);
            })));
        }), React.createElement("button", { type: "button", disabled: props.busy, style: actionStyle,
          "data-memory-engine-appearance-reset": props.location,
          onClick: function () { props.onChange({ graphTheme: "classic", graphLayout: "sphere" }); } }, "恢复默认"));
    }

    function requestApi(url, options) {
      return fetch(url, Object.assign({ cache: "no-store" }, options)).then(function (response) {
        return response.json().then(function (result) {
          if (!response.ok || !result || result.ok !== true) throw new Error(result && result.error || "HTTP " + response.status);
          if (!result.data || typeof result.data !== "object") throw new Error("接口返回格式无效");
          return result.data;
        });
      });
    }

    function readApi(url, signal) { return requestApi(url, { signal: signal }); }

    function loadSettings() {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 5000);
      return Promise.resolve().then(function () {
        return readApi("/memory-engine/api/config", controller.signal);
      }).then(function (settings) {
        if (typeof settings.hideButton !== "boolean" || typeof settings.showGuideOnEmpty !== "boolean") throw new Error("按钮配置格式无效");
        return settings;
      }).finally(function () { clearTimeout(timer); });
    }

    function copyText(text) {
      function fallback() {
        var area = document.createElement("textarea");
        var active = document.activeElement;
        area.value = text;
        area.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(area);
        area.select();
        try {
          if (!document.execCommand("copy")) throw new Error("复制失败");
        } finally {
          area.remove();
          if (active && typeof active.focus === "function") active.focus();
        }
      }
      return Promise.resolve().then(function () {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
        return fallback();
      }).catch(function () { return fallback(); });
    }

    function GuideCard(props) {
      var copiedState = React.useState("复制这段提示词");
      var copyLabel = copiedState[0];
      var setCopyLabel = copiedState[1];
      var card = React.useRef(null);
      React.useEffect(function () { if (card.current) card.current.focus(); }, []);
      function trapTab(event) {
        if (event.key !== "Tab" || !card.current) return;
        var buttons = Array.from(card.current.querySelectorAll("button"));
        var position = buttons.indexOf(document.activeElement);
        if (event.shiftKey && position <= 0) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
        else if (!event.shiftKey && (position === -1 || position === buttons.length - 1)) { event.preventDefault(); buttons[0].focus(); }
      }
      var data = props.data;
      return React.createElement("div", {
        "data-memory-engine-guide-layer": "true",
        style: { position: "absolute", inset: 0, zIndex: 2, display: "grid", placeItems: "center", padding: "16px", background: "rgba(3,6,12,.7)" },
      }, React.createElement("section", {
        ref: card, role: "dialog", "aria-modal": "true", "aria-label": "使用指南", tabIndex: -1,
        "data-memory-engine-guide": "true", onKeyDown: trapTab,
        style: { boxSizing: "border-box", width: "min(620px,100%)", maxHeight: "calc(100vh - 32px)", overflow: "auto", padding: "24px", border: "1px solid #3976a0", borderRadius: "16px", background: "#07111f", color: "#dbeaf8", font: "14px/1.65 system-ui,sans-serif", boxShadow: "0 16px 80px #0008" },
      }, React.createElement("h2", { style: { margin: "0 0 16px", fontSize: "22px", color: "#b7e9ff" } }, "怎么用"),
      props.error ? React.createElement("div", { role: "alert" },
        React.createElement("p", null, "引导加载失败，请重试。"),
        React.createElement("button", { type: "button", onClick: props.onRetry, style: actionStyle }, "重试"))
        : !data ? React.createElement("p", { role: "status" }, "正在加载使用指南……")
        : React.createElement(React.Fragment, null,
          data.empty ? React.createElement("p", { style: { color: "#9fb7ce" } }, "还没有记忆，从下面任一步开始。") : null,
          data.steps.map(function (step, index) {
            return React.createElement("div", { key: index, style: { borderLeft: "3px solid #28577e", paddingLeft: "14px", marginBottom: "18px" } },
              React.createElement("h3", { style: { fontSize: "15px", color: "#9fd0f5", margin: "0 0 6px" } }, "第 " + (index + 1) + " 步  " + step.title),
              React.createElement("p", { style: { margin: "0 0 8px" } }, step.body),
              index === 0 ? React.createElement(React.Fragment, null,
                React.createElement("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "180px", overflow: "auto", margin: "8px 0", padding: "12px", background: "#030a13", borderRadius: "8px", font: "12px/1.6 ui-monospace,Consolas,monospace" } }, data.prompt),
                React.createElement("button", { type: "button", "data-memory-engine-copy": "true", style: actionStyle,
                  onClick: function () { copyText(data.prompt).then(function () { setCopyLabel("已复制 ✓"); }, function () { setCopyLabel("复制失败，请手动复制"); }); },
                }, copyLabel)) : null,
              index === 2 ? React.createElement("button", { type: "button", onClick: props.onRefresh, style: actionStyle }, "刷新图谱") : null);
          }),
          React.createElement("p", { style: { fontSize: "12px", color: "#9fb7ce", overflowWrap: "anywhere" } }, "数据目录：", data.dataDir)),
      React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: "16px" } },
        React.createElement("button", { type: "button", onClick: props.onClose, style: actionStyle }, "知道了"))));
    }

    function MemoryDetails(props) {
      var node = props.node;
      var text = typeof node.text === "string" ? node.text : "";
      if (node.isCore) text = Array.from(text).slice(0, 4000).join("");
      var defaultCopyLabel = node.isCore ? "复制全文" : "复制正文";
      var title = String(node.title || "").trim() || Array.from(text).slice(0, 20).join("");
      var date = new Date(node.ts);
      var day = Number.isFinite(date.getTime()) ? date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0") : "未知";
      var heat = { 1: "热", 2: "温", 3: "冷" }[node.heat];
      var rows = [
        ["重要度", heat ? heat + "（" + node.heat + "）" : "未知"],
        ["留存", Number.isFinite(node.retention) ? node.retention.toFixed(2) : "—"],
        ["连接数", node.degree == null ? 0 : node.degree],
        ["时间", day],
      ];
      var emotion = Array.isArray(node.emotion) ? node.emotion.filter(function (item) { return item && item.tag; }).map(function (item) { return item.tag; }).join(" / ") : "";
      if (emotion) rows.push(["情绪", emotion]);
      var copiedState = React.useState(defaultCopyLabel);
      var copyLabel = copiedState[0];
      var setCopyLabel = copiedState[1];
      var timer = React.useRef(null);
      var copyVersion = React.useRef(0);
      var body = React.useRef(null);
      React.useEffect(function () {
        copyVersion.current++;
        clearTimeout(timer.current);
        timer.current = null;
        setCopyLabel(defaultCopyLabel);
        if (body.current) body.current.scrollTop = 0;
        return function () { copyVersion.current++; clearTimeout(timer.current); timer.current = null; };
      }, [node.id, text, defaultCopyLabel]);
      function copyBody() {
        var version = ++copyVersion.current;
        clearTimeout(timer.current);
        copyText(text).then(function () {
          if (version !== copyVersion.current) return;
          setCopyLabel("已复制 ✓");
          timer.current = setTimeout(function () {
            if (version === copyVersion.current) setCopyLabel(defaultCopyLabel);
            timer.current = null;
          }, 1800);
        }, function () {
          if (version === copyVersion.current) setCopyLabel("复制失败，请重试");
        });
      }
      return React.createElement("section", {
        role: "region", "aria-label": "记忆详情", "data-memory-engine-detail": "true", "data-memory-engine-node": node.id,
        style: { position: "absolute", top: "72px", right: "18px", zIndex: 1, width: "min(350px,calc(100% - 36px))", maxHeight: "calc(100% - 96px)", boxSizing: "border-box", display: "flex", flexDirection: "column", overflow: "hidden", padding: "18px", border: "1px solid #3976a0", borderRadius: "14px", background: "#07111fee", color: "#dbeaf8", font: "14px/1.6 system-ui,sans-serif", boxShadow: "0 0 40px #1763a033", backdropFilter: "blur(8px)", animation: "dsh-memory-detail-in 180ms ease-out" },
      }, React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexShrink: 0 } },
        React.createElement("span", { "data-memory-engine-detail-kind": "true", style: { color: "#a4e6ff", background: "#15344b", borderRadius: "6px", padding: "2px 8px", overflowWrap: "anywhere" } }, node.kind || "未分类"),
        React.createElement("button", { type: "button", "aria-label": "关闭记忆详情", onClick: props.onClose, style: Object.assign({ minWidth: "40px", minHeight: "40px", fontSize: "18px", lineHeight: 1, cursor: "pointer" }, { border: 0, padding: "2px 6px", background: "transparent", color: "#a4bad0", fontSize: "22px", cursor: "pointer" }) }, "×")),
      React.createElement("h2", { "data-memory-engine-detail-title": "true", style: { margin: "10px 0", fontSize: "18px", color: "#b7e9ff", overflowWrap: "anywhere", whiteSpace: "normal", maxHeight: "18vh", overflowY: "auto", flexShrink: 0 } }, title),
      node.isCore ? null : React.createElement("dl", { style: { display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", gap: "5px 10px", margin: "0 0 12px", fontSize: "12px", color: "#9fb7ce", maxHeight: "25vh", overflowY: "auto", flexShrink: 0 } },
        rows.map(function (row) { return React.createElement(React.Fragment, { key: row[0] },
          React.createElement("dt", { style: { margin: 0 } }, row[0]),
          React.createElement("dd", { style: { margin: 0, overflowWrap: "anywhere" } }, row[1])); })),
      React.createElement("div", { ref: body, "data-memory-engine-detail-text": "true", style: { minHeight: 0, flex: "1 1 auto", overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", borderTop: "1px solid #3976a055", borderBottom: "1px solid #3976a055", padding: "12px 0" } }, text),
      React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px", flexShrink: 0 } },
        node.isCore ? null : React.createElement("button", { type: "button", "data-memory-engine-highlight": "true", style: actionStyle, onClick: props.onHighlight }, "在图里高亮它"),
        React.createElement("button", { type: "button", "data-memory-engine-copy-body": "true", style: actionStyle, onClick: copyBody }, copyLabel)));
    }

    function MemoryCanvas(props) {
      var canvas = React.useRef(null);
      var appearance = React.useRef(null);
      appearance.current = { graphTheme: props.graphTheme || "classic", graphLayout: props.graphLayout || "sphere" };
      var dataState = React.useState(null);
      var data = dataState[0];
      var setData = dataState[1];
      var errorState = React.useState("");
      var error = errorState[0];
      var setError = errorState[1];
      var retryState = React.useState(0);
      var retry = retryState[0];
      var setRetry = retryState[1];
      React.useEffect(function () {
        var controller = new AbortController();
        var active = true;
        var renderer;
        setError("");
        readApi("/memory-engine/api/map", controller.signal).then(function (nextData) {
          if (!active) return;
          renderer = createRenderer(canvas.current, nextData, Object.assign({ frameInterval: 25, layoutNodes: layoutPositions }, appearance.current));
          props.rendererRef.current = renderer;
          renderer.onSelect(function (node) { props.selectionVersion.current++; props.onSelect(node); });
          renderer.start();
          setData(nextData);
        }).catch(function (failure) {
          if (!active) return;
          if (renderer) renderer.destroy();
          if (props.rendererRef.current === renderer) props.rendererRef.current = null;
          console.error("[dsh-memory-engine] Canvas 图谱加载失败：", failure);
          setError(failure.message);
        });
        return function () {
          active = false;
          controller.abort();
          if (renderer) renderer.destroy();
          if (props.rendererRef.current === renderer) props.rendererRef.current = null;
        };
      }, [retry, props.rendererRef, props.selectionVersion, props.onSelect]);
      React.useEffect(function () {
        if (!props.rendererRef.current) return;
        props.rendererRef.current.setTheme(appearance.current.graphTheme);
        props.rendererRef.current.setLayout(appearance.current.graphLayout);
      }, [props.graphTheme, props.graphLayout]);
      return React.createElement(React.Fragment, null,
        React.createElement("canvas", {
          ref: canvas, "data-memory-engine-canvas": "true", "aria-label": "记忆神经网络",
          style: { display: "block", width: "100%", height: "100%", touchAction: "none", cursor: "grab" },
        }),
        React.createElement("div", {
          "data-memory-engine-summary": "true",
          style: { position: "absolute", top: "16px", left: "18px", pointerEvents: "none", color: "var(--memory-text,#d8e9f8)", font: "13px/1.65 system-ui,sans-serif", textShadow: "var(--memory-shadow,0 0 12px #3388bb88)" },
        }, React.createElement("strong", { style: { color: "var(--memory-accent,#a4e6ff)", fontSize: "16px" } }, "记忆神经网络"),
        React.createElement("div", null, data ? data.nodes.length + " 个神经元 · " + data.links.length + " 条突触" : "正在加载图谱……"),
        React.createElement("div", { style: { color: "var(--memory-muted,#7491a8)", fontSize: "12px" } }, "大小＝重要度和连接数 · 亮度＝留存")),
        data ? React.createElement("section", {
          "aria-label": "复习清单",
          style: { position: "absolute", bottom: "16px", left: "18px", width: "min(400px,calc(100% - 36px))", boxSizing: "border-box", maxHeight: "32%", overflow: "auto", padding: "15px", background: "var(--memory-panel,#07111fee)", border: "1px solid var(--memory-border,#3976a055)", borderRadius: "14px", boxShadow: "var(--memory-shadow,0 0 40px #1763a033)", backdropFilter: "blur(8px)", font: "12px/1.65 system-ui,sans-serif", color: "var(--memory-text,#b1c6d9)" },
        }, React.createElement("h2", { style: { fontSize: "14px", color: "var(--memory-accent,#ffdb82)", margin: "0 0 8px" } }, "复习清单 · 留存最低的记忆"),
        data.review.map(function (item, index) {
          return React.createElement("div", { key: item.id || index, style: { display: "flex", gap: "7px", alignItems: "center", margin: "5px 0" } },
            React.createElement("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, (index + 1) + ". [" + item.kind + "] " + item.title),
            React.createElement("span", { style: { width: "52px", height: "5px", borderRadius: "5px", background: "var(--memory-border,#335066)", overflow: "hidden" } },
              React.createElement("i", { style: { display: "block", height: "100%", background: "var(--memory-accent,#6bc9fa)", width: Math.min(100, Math.max(0, item.retention * 100)) + "%" } })));
        })) : null,
        React.createElement("div", { style: { position: "absolute", right: "18px", bottom: "18px", pointerEvents: "none", color: "var(--memory-muted,#7b99ad)", font: "13px system-ui,sans-serif" } }, "拖拽旋转 · 滚轮缩放 · 点光点看关联"),
        error ? React.createElement("div", { role: "alert", style: { position: "absolute", inset: "40% 20% auto", textAlign: "center", color: "#d8e9f8" } },
          React.createElement("p", null, "图谱加载失败：" + error),
          React.createElement("button", { type: "button", style: actionStyle, onClick: function () { setRetry(function (value) { return value + 1; }); } }, "重试")) : null);
    }

    function ConfirmationDialog(props) {
      var valueState = React.useState("");
      var value = valueState[0], setValue = valueState[1];
      var errorState = React.useState("");
      var error = errorState[0], setError = errorState[1];
      var form = React.useRef(null);
      React.useEffect(function () {
        var active = document.activeElement;
        var target = form.current && form.current.querySelector("input,button");
        if (target) target.focus();
        return function () { if (active && active.isConnected) active.focus(); };
      }, []);
      function onKey(event) {
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation();
          if (!props.busy) props.onClose();
        }
        if (event.key === "Tab" && form.current) {
          var controls = Array.from(form.current.querySelectorAll("input,button")).filter(function (control) { return !control.disabled; });
          if (!controls.length) { event.preventDefault(); return; }
          var index = controls.indexOf(document.activeElement);
          if (event.shiftKey && index <= 0) { event.preventDefault(); controls[controls.length - 1].focus(); }
          else if (!event.shiftKey && (index === -1 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
        }
      }
      return React.createElement("div", { "data-memory-engine-confirm": "true", onKeyDown: onKey,
        style: { position: "fixed", inset: 0, zIndex: 3, display: "grid", placeItems: "center", padding: "24px", background: "#03060ccc" } },
        React.createElement("form", { ref: form, role: "dialog", "aria-modal": "true", "aria-label": props.title,
          onSubmit: function (event) {
            event.preventDefault();
            if (props.busy) return;
            if (props.requireDelete && value !== "DELETE") { setError("请输入大写 DELETE，其他内容不会执行清空。"); return; }
            setError(""); props.onConfirm();
          },
          style: { width: "min(460px,100%)", padding: "24px", border: "1px solid #8b505c", borderRadius: "16px", background: "#101a29", color: "#e2f4ff", boxShadow: "0 16px 80px #0008" } },
          React.createElement("h2", { style: { margin: "0 0 12px", fontSize: "20px" } }, props.title),
          React.createElement("p", { style: { color: "#c2cedc" } }, props.message),
          props.requireDelete ? React.createElement("label", null, "输入 DELETE 确认",
            React.createElement("input", { "aria-label": "输入 DELETE 确认", autoComplete: "off", value: value, disabled: props.busy,
              onChange: function (event) { setValue(event.target.value); setError(""); }, style: Object.assign({}, fieldStyle, { display: "block", width: "100%", marginTop: "8px" }) })) : null,
          error || props.error ? React.createElement("p", { role: "alert", style: { color: "#ffb8b8" } }, error || props.error) : null,
          React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "24px" } },
            React.createElement("button", { type: "button", disabled: props.busy, onClick: props.onClose, style: actionStyle }, "取消"),
            React.createElement("button", { type: "submit", disabled: props.busy, style: Object.assign({}, actionStyle, { borderColor: "#c86b7a", background: "#572a38" }) }, props.busy ? "正在处理…" : props.submitLabel))));
    }

    function MemoryRow(props) {
      var item = props.item;
      var expandedState = React.useState(false);
      var expanded = expandedState[0], setExpanded = expandedState[1];
      var detailState = React.useState(item);
      var detail = detailState[0], setDetail = detailState[1];
      var editState = React.useState(null);
      var edit = editState[0], setEdit = editState[1];
      var confirmState = React.useState(false);
      var confirming = confirmState[0], setConfirming = confirmState[1];
      var errorState = React.useState("");
      var error = errorState[0], setError = errorState[1];
      var loadingState = React.useState(false);
      var loading = loadingState[0], setLoading = loadingState[1];
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var mutation = React.useRef(null);
      React.useEffect(function () { return function () { if (mutation.current) mutation.current.abort(); }; }, []);
      React.useEffect(function () {
        if (!expanded) return;
        var controller = new AbortController();
        setLoading(true); setError("");
        readApi("/memory-engine/api/item/" + encodeURIComponent(item.id), controller.signal).then(function (result) {
          if (!controller.signal.aborted) setDetail(result);
        }).catch(function (failure) {
          if (!controller.signal.aborted) setError("读取详情失败：" + failure.message);
        }).finally(function () { if (!controller.signal.aborted) setLoading(false); });
        return function () { controller.abort(); };
      }, [expanded, item.id]);
      function mutate(method) {
        if (mutation.current) return;
        var controller = new AbortController();
        mutation.current = controller;
        setBusy(true); setError("");
        var options = { method: method, signal: controller.signal };
        if (method === "PUT") { options.headers = { "Content-Type": "application/json" }; options.body = JSON.stringify(edit); }
        requestApi("/memory-engine/api/item/" + encodeURIComponent(item.id), options).then(function () {
          if (controller.signal.aborted) return;
          setEdit(null); setExpanded(false); setConfirming(false); props.onChanged();
        }).catch(function (failure) {
          if (!controller.signal.aborted) setError((method === "PUT" ? "保存失败：" : "删除失败：") + failure.message);
        }).finally(function () {
          if (!controller.signal.aborted) { mutation.current = null; setBusy(false); }
        });
      }
      function change(field, value) { setEdit(function (previous) { var next = Object.assign({}, previous); next[field] = value; return next; }); }
      var choices = kinds.includes(detail.kind) ? kinds : [detail.kind].concat(kinds);
      return React.createElement("article", { "data-memory-engine-row": item.id,
        style: { marginBottom: "12px", border: "1px solid " + (expanded ? "#4c85a4" : "#263f54"), borderRadius: "12px", background: "#0b1624", overflowWrap: "anywhere" } },
        React.createElement("button", { type: "button", "data-memory-engine-expand": item.id, "aria-expanded": expanded, disabled: busy,
          onClick: function () { setExpanded(!expanded); setEdit(null); setError(""); },
          style: { width: "100%", display: "block", padding: "18px 20px", border: 0, borderRadius: "12px", background: "transparent", color: "inherit", textAlign: "left", font: "inherit", cursor: "pointer" } },
          React.createElement("span", { style: { display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" } },
            React.createElement("span", { style: { color: "#a4e6ff", background: "#15344b", padding: "2px 8px", borderRadius: "6px", flexShrink: 0 } }, item.kind),
            React.createElement("strong", { style: { flex: "1 1 180px", overflowWrap: "anywhere" } }, item.title),
            React.createElement("span", { style: { color: "#8db0c7", fontSize: "12px", whiteSpace: "nowrap" } }, "留存 " + item.retention.toFixed(2) + " · " + item.degree + " 个连接")),
          !expanded ? React.createElement("span", { style: { display: "block", color: "#9fb7ce", marginTop: "8px", overflowWrap: "anywhere" } }, item.preview) : null),
        expanded ? React.createElement("div", { style: { padding: "0 20px 18px" } },
          loading ? React.createElement("p", { role: "status" }, "正在读取全文…") : null,
          edit ? React.createElement("form", { "data-memory-engine-editor": item.id, onSubmit: function (event) { event.preventDefault(); mutate("PUT"); } },
            React.createElement("textarea", { "aria-label": "记忆正文", value: edit.text, disabled: busy,
              onChange: function (event) { change("text", event.target.value); },
              style: Object.assign({}, fieldStyle, { width: "100%", minHeight: "150px", maxHeight: "40vh", resize: "vertical", lineHeight: 1.7 }) }),
            React.createElement("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap", margin: "12px 0" } },
              React.createElement("label", null, "分类 ", React.createElement("select", { "aria-label": "编辑分类", value: edit.kind, disabled: busy, style: fieldStyle,
                onChange: function (event) { change("kind", event.target.value); } }, choices.map(function (value) { return React.createElement("option", { key: value, value: value }, value); }))),
              React.createElement("label", null, "重要度 ", React.createElement("select", { "aria-label": "编辑重要度", value: edit.heat, disabled: busy, style: fieldStyle,
                onChange: function (event) { change("heat", Number(event.target.value)); } },
                [[1, "热（1）"], [2, "温（2）"], [3, "冷（3）"]].map(function (entry) { return React.createElement("option", { key: entry[0], value: entry[0] }, entry[1]); }))),
              React.createElement("label", null, "相关人 ", React.createElement("input", { "aria-label": "编辑相关人", value: edit.who, disabled: busy,
                onChange: function (event) { change("who", event.target.value); }, style: Object.assign({}, fieldStyle, { width: "140px" }) }))),
            React.createElement("div", { style: { display: "flex", gap: "8px" } },
              React.createElement("button", { type: "submit", disabled: busy, "data-memory-engine-save": "true", style: actionStyle }, busy ? "正在保存…" : "保存"),
              React.createElement("button", { type: "button", disabled: busy, "data-memory-engine-cancel-edit": "true", style: actionStyle,
                onClick: function () { setEdit(null); setExpanded(false); setError(""); } }, "取消")))
            : React.createElement(React.Fragment, null,
              React.createElement("div", { "data-memory-engine-full-text": "true", style: { whiteSpace: "pre-wrap", maxHeight: "40vh", overflowY: "auto", color: "#c2d3e3", marginBottom: "14px" } }, detail.text),
              React.createElement("div", { style: { display: "flex", gap: "8px" } },
                React.createElement("button", { type: "button", "data-memory-engine-edit": item.id, disabled: loading || busy, style: actionStyle,
                  onClick: function () { setError(""); setEdit({ text: detail.text, kind: detail.kind, heat: detail.heat, who: detail.who || "" }); } }, "编辑"),
                React.createElement("button", { type: "button", "data-memory-engine-delete": item.id, disabled: loading || busy,
                  onClick: function () { setError(""); setConfirming(true); }, style: Object.assign({}, actionStyle, { color: "#ffb8b8", borderColor: "#8b505c" }) }, "删除"))),
          error ? React.createElement("p", { role: "alert", style: { color: "#ffb8b8" } }, error) : null) : null,
        confirming ? React.createElement(ConfirmationDialog, { title: "删除这条记忆", message: "确定删除这条记忆？不可撤销。操作前会保留备份。", submitLabel: "确定删除",
          busy: busy, error: error, onClose: function () { setConfirming(false); }, onConfirm: function () { mutate("DELETE"); } }) : null);
    }

    function MemoryList(props) {
      var searchState = React.useState("");
      var search = searchState[0], setSearch = searchState[1];
      var queryState = React.useState("");
      var query = queryState[0], setQuery = queryState[1];
      var kindState = React.useState("");
      var kind = kindState[0], setKind = kindState[1];
      var sortState = React.useState("recent");
      var sort = sortState[0], setSort = sortState[1];
      var offsetState = React.useState(0);
      var offset = offsetState[0], setOffset = offsetState[1];
      var pageState = React.useState({ items: [], total: 0, allTotal: 0 });
      var page = pageState[0], setPage = pageState[1];
      var loadingState = React.useState(true);
      var loading = loadingState[0], setLoading = loadingState[1];
      var errorState = React.useState("");
      var error = errorState[0], setError = errorState[1];
      var retryState = React.useState(0);
      var retry = retryState[0], setRetry = retryState[1];
      function refresh() {
        setOffset(0); setRetry(function (value) { return value + 1; });
        if (props.onChanged) props.onChanged();
      }
      React.useEffect(function () {
        if (search === query) return;
        var timer = setTimeout(function () { setOffset(0); setQuery(search); }, 250);
        return function () { clearTimeout(timer); };
      }, [search]);
      React.useEffect(function () {
        var controller = new AbortController();
        var active = true;
        setLoading(true); setError("");
        var params = new URLSearchParams({ q: query, kind: kind, sort: sort, limit: "50", offset: String(offset) });
        readApi("/memory-engine/api/list?" + params, controller.signal).then(function (result) {
          if (!active) return;
          setPage(function (previous) { return Object.assign({}, result, { items: offset === 0 ? result.items : previous.items.concat(result.items) }); });
        }).catch(function (failure) {
          if (active) setError("加载记忆失败：" + failure.message);
        }).finally(function () { if (active) setLoading(false); });
        return function () { active = false; controller.abort(); };
      }, [query, kind, sort, offset, retry]);
      return React.createElement("section", {
        "aria-label": "记忆列表", "data-memory-engine-list": "true",
        style: { position: "absolute", inset: "76px 0 0", display: "flex", flexDirection: "column", color: "#dbeaf8", font: "14px/1.6 system-ui,sans-serif" },
      }, React.createElement("div", { style: { width: "min(980px,100%)", margin: "0 auto", padding: "0 24px 16px", display: "flex", gap: "12px", flexWrap: "wrap" } },
        React.createElement("input", { type: "search", "aria-label": "搜索记忆", placeholder: "搜索正文或标题…", value: search,
          onChange: function (event) { setSearch(event.target.value); }, style: Object.assign({}, fieldStyle, { flex: "1 1 220px" }) }),
        React.createElement("select", { "aria-label": "分类筛选", value: kind, style: fieldStyle,
          onChange: function (event) { setOffset(0); setKind(event.target.value); } },
          [""].concat(kinds).map(function (value) { return React.createElement("option", { key: value, value: value }, value || "全部分类"); })),
        React.createElement("select", { "aria-label": "记忆排序", value: sort, style: fieldStyle,
          onChange: function (event) { setOffset(0); setSort(event.target.value); } },
          [["recent", "最近"], ["oldest", "最老"], ["fading", "快忘了"], ["degree", "连接最多"]].map(function (entry) { return React.createElement("option", { key: entry[0], value: entry[0] }, entry[1]); }))),
      React.createElement("div", { "data-memory-engine-list-scroll": "true", style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "0 24px 24px" } },
        React.createElement("div", { style: { maxWidth: "932px", margin: "0 auto" }, "aria-busy": loading },
          error ? React.createElement("div", { role: "alert", style: { color: "#ffb8b8", padding: "16px" } }, error,
            React.createElement("button", { type: "button", style: actionStyle, onClick: function () { setRetry(function (value) { return value + 1; }); } }, "重试")) : null,
          page.items.map(function (item) {
            return React.createElement(MemoryRow, { key: item.id, item: item, onChanged: refresh });
          }),
          !loading && !error && !page.items.length ? React.createElement("p", { role: "status", style: { padding: "24px", textAlign: "center", color: "#9fb7ce" } }, page.allTotal ? "没有匹配的记忆，试试其他关键词或分类。" : "还没有记忆，可以点右上角 ? 查看导入方法。") : null)),
          React.createElement("div", { "data-memory-engine-list-total": "true", style: { padding: "14px", textAlign: "center", color: "#9fb7ce", flexShrink: 0, borderTop: "1px solid #263f54" } },
            "共 " + page.total + " 条 · 已显示 " + page.items.length + " 条",
            loading ? React.createElement("span", { role: "status" }, " · 正在加载…") : null,
            page.items.length < page.total ? React.createElement("button", { type: "button", "data-memory-engine-more": "true", disabled: loading || search !== query || !!error,
              onClick: function () { setOffset(page.items.length); }, style: Object.assign({}, actionStyle, { marginLeft: "12px", opacity: loading ? 0.5 : 1 }) }, "加载更多") : null));
    }

    function AutoMemoryToggle(props) {
      var enabled = props.settings.autoMemory && props.settings.autoMemory.enabled === true;
      var maximum = props.settings.autoMemory && props.settings.autoMemory.maxPerTurn || 2;
      return React.createElement("button", {
        type: "button", role: "switch", "aria-checked": enabled, "aria-label": "自动记忆",
        "data-memory-engine-auto-memory": props.location, disabled: props.busy, onClick: props.onToggle,
        title: enabled ? "当前：开（每轮对话后会抽 0~" + maximum + " 条记忆）" : "当前：关（不会自动调用模型抽取记忆）",
        style: Object.assign({}, actionStyle, { color: enabled ? "#e2f4ff" : "#8195aa", borderColor: enabled ? "#64bca0" : "#35536b", opacity: props.busy ? 0.6 : 1 }),
      }, React.createElement("span", { "aria-hidden": "true", style: { color: enabled ? "#89f0bb" : "#8195aa", textShadow: enabled ? "0 0 8px #56d890" : "none" } }, enabled ? "●" : "○"), " 自动记忆");
    }

    function MemorySettings(props) {
      var statsState = React.useState(null);
      var stats = statsState[0], setStats = statsState[1];
      var errorState = React.useState("");
      var error = errorState[0], setError = errorState[1];
      var noticeState = React.useState("");
      var notice = noticeState[0], setNotice = noticeState[1];
      var retryState = React.useState(0);
      var retry = retryState[0], setRetry = retryState[1];
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var confirmState = React.useState(false);
      var confirming = confirmState[0], setConfirming = confirmState[1];
      var mutation = React.useRef(null);
      var download = React.useRef(null);
      var timer = React.useRef(null);
      var active = React.useRef(true);
      React.useEffect(function () {
        active.current = true;
        return function () {
          active.current = false;
          if (mutation.current) mutation.current.abort();
          clearTimeout(timer.current);
          if (download.current) URL.revokeObjectURL(download.current);
        };
      }, []);
      React.useEffect(function () {
        var controller = new AbortController();
        setError("");
        readApi("/memory-engine/api/stats", controller.signal).then(function (result) {
          if (!controller.signal.aborted) setStats(result);
        }).catch(function (failure) {
          if (!controller.signal.aborted) setError("读取设置失败：" + failure.message);
        });
        return function () { controller.abort(); };
      }, [retry]);
      function manage(clearing) {
        if (mutation.current) return;
        var controller = new AbortController();
        mutation.current = controller; setBusy(true); setError(""); setNotice("");
        var options = { signal: controller.signal };
        if (clearing) { options.method = "POST"; options.headers = { "Content-Type": "application/json" }; options.body = JSON.stringify({ confirm: "DELETE" }); }
        requestApi("/memory-engine/api/" + (clearing ? "clear" : "export"), options).then(function (result) {
          if (controller.signal.aborted) return;
          if (clearing) { props.onCleared(); return; }
          if (download.current) URL.revokeObjectURL(download.current);
          clearTimeout(timer.current);
          download.current = URL.createObjectURL(new Blob([JSON.stringify({ ok: true, data: result }, null, 2) + "\n"], { type: "application/json;charset=utf-8" }));
          var anchor = document.createElement("a");
          var date = new Date();
          anchor.href = download.current;
          anchor.download = "memories-" + date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0") + ".json";
          document.body.appendChild(anchor); anchor.click(); anchor.remove();
          timer.current = setTimeout(function () { URL.revokeObjectURL(download.current); download.current = null; timer.current = null; }, 1000);
          setNotice("已开始下载，共 " + result.total + " 条记忆。");
        }).catch(function (failure) {
          if (!controller.signal.aborted) setError((clearing ? "清空失败：" : "导出失败：") + failure.message);
        }).finally(function () {
          if (!controller.signal.aborted) { mutation.current = null; setBusy(false); }
        });
      }
      var directory = stats ? stats.file.replace(/[\\/][^\\/]*$/, "") : "";
      return React.createElement("section", { "aria-label": "记忆设置", "data-memory-engine-settings": "true",
        style: { position: "absolute", inset: "76px 0 0", overflowY: "auto", padding: "0 24px 32px", color: "#dbeaf8", font: "14px/1.7 system-ui,sans-serif" } },
        React.createElement("div", { style: { maxWidth: "900px", margin: "0 auto", padding: "28px", border: "1px solid #263f54", borderRadius: "14px", background: "#0b1624" } },
          props.settings.autoImport?.hint === "no-session-matched" ? React.createElement("div", { role: "alert", "data-memory-engine-import-hint": "true",
            style: { marginBottom: "20px", padding: "12px 16px", border: "1px solid #9c7243", borderRadius: "8px", background: "#2a2118", color: "#ffe1ac" } },
            React.createElement("span", null, props.settings.autoImport.message), " ",
            React.createElement("button", { type: "button", "data-memory-engine-use-auto-import": "true", disabled: props.configBusy,
              onClick: props.onUseAutoImport, style: actionStyle }, "改用宽松模式")) : null,
          React.createElement("section", { style: { marginBottom: "24px", padding: "20px", border: "1px solid var(--memory-border,#263f54)", borderRadius: "10px", background: "var(--memory-panel,#0b1624)" } },
            React.createElement("h2", { style: { margin: "0 0 12px", fontSize: "20px", color: "var(--memory-accent,#b7e9ff)" } }, "图谱外观"),
            React.createElement(AppearanceControls, { settings: props.settings, busy: props.configBusy, onChange: props.onAppearanceChange, location: "settings" })),
          React.createElement("section", { style: { marginBottom: "24px", paddingBottom: "20px", borderBottom: "1px solid #263f54" } },
            React.createElement("h2", { style: { margin: "0 0 12px", fontSize: "20px", color: "#b7e9ff" } }, "自动记忆"),
            React.createElement(AutoMemoryToggle, { settings: props.settings, busy: props.configBusy, onToggle: props.onToggle, location: "settings" }),
            React.createElement("p", { style: { color: "#9fb7ce", marginBottom: 0 } }, "默认关闭。开启后每轮对话会额外调用一次模型，抽取值得记住的事实；通常最多 2 条，可随时关闭。大约每轮几分钱，实际费用以模型及计费方案为准。自动导入是独立设置，不受此开关控制。")),
          React.createElement("h2", { style: { margin: "0 0 20px", fontSize: "20px", color: "#b7e9ff" } }, "数据管理"),
          stats ? React.createElement(React.Fragment, null,
            React.createElement("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "12px" } },
              React.createElement("span", { style: { flex: "1 1 360px", overflowWrap: "anywhere" } }, "数据目录：", React.createElement("code", { "data-memory-engine-directory": "true" }, directory)),
              React.createElement("button", { type: "button", "data-memory-engine-copy-path": "true", style: actionStyle,
                onClick: function () {
                  setNotice(""); setError("");
                  copyText(directory).then(function () { if (active.current) setNotice("数据目录已复制 ✓"); }, function () { if (active.current) setError("复制路径失败，请手动复制上方目录。"); });
                } }, "复制路径")),
            React.createElement("p", { "data-memory-engine-storage-stats": "true", style: { color: "#9fb7ce", margin: "16px 0 24px" } }, "记忆条数：" + stats.total + "　 文件大小：" + (stats.bytes / 1024).toFixed(1) + " KB"))
            : React.createElement("p", { role: "status" }, error ? "暂时无法读取数据目录。" : "正在读取数据目录…"),
          error ? React.createElement("div", { role: "alert", style: { color: "#ffb8b8", marginBottom: "16px" } }, error,
            !stats ? React.createElement("button", { type: "button", style: actionStyle, onClick: function () { setRetry(function (value) { return value + 1; }); } }, "重试") : null) : null,
          notice ? React.createElement("p", { role: "status", style: { color: "#9fe5c4" } }, notice) : null,
          React.createElement("div", { style: { padding: "24px 0", borderTop: "1px solid #263f54", borderBottom: "1px solid #263f54" } },
            React.createElement("button", { type: "button", "data-memory-engine-export": "true", disabled: busy, onClick: function () { manage(false); }, style: actionStyle }, "导出全部记忆（JSON）"),
            React.createElement("p", { style: { margin: "10px 0 0", fontSize: "12px", color: "#9fb7ce" } }, "下载包含全部原始条目的 JSON 文件。导入已有记忆请使用 memory_import 工具。")),
          React.createElement("h3", { style: { color: "#ffb8b8", marginTop: "24px" } }, "危险操作"),
          React.createElement("p", { style: { color: "#9fb7ce" } }, "清空前会自动备份，最近五份操作备份保留在数据目录。"),
          React.createElement("button", { type: "button", "data-memory-engine-clear": "true", disabled: busy,
            onClick: function () { setError(""); setNotice(""); setConfirming(true); }, style: Object.assign({}, actionStyle, { color: "#ffb8b8", borderColor: "#8b505c", background: "#341c28" }) }, "清空全部记忆")),
        confirming ? React.createElement(ConfirmationDialog, { title: "清空全部记忆", message: "这会删除当前记忆库的全部条目。请确认已导出需要保留的内容。", requireDelete: true,
          submitLabel: "确认清空", busy: busy, error: error, onClose: function () { setConfirming(false); }, onConfirm: function () { manage(true); } }) : null);
    }

    function MemoryButton(props) {
      var state = React.useState(false);
      var open = state[0];
      var setOpen = state[1];
      var settingsState = React.useState(Object.assign({}, defaultSettings, props.settings));
      var settings = settingsState[0], setSettings = settingsState[1];
      var configBusyState = React.useState(false);
      var configBusy = configBusyState[0], setConfigBusy = configBusyState[1];
      var configErrorState = React.useState("");
      var configError = configErrorState[0], setConfigError = configErrorState[1];
      var costHintState = React.useState(false);
      var costHint = costHintState[0], setCostHint = costHintState[1];
      var configRequest = React.useRef(null);
      var guideState = React.useState(false);
      var guideOpen = guideState[0];
      var setGuideOpen = guideState[1];
      var dataState = React.useState(null);
      var guideData = dataState[0];
      var setGuideData = dataState[1];
      var errorState = React.useState("");
      var guideError = errorState[0];
      var setGuideError = errorState[1];
      var retryState = React.useState(0);
      var retry = retryState[0];
      var setRetry = retryState[1];
      var selectedState = React.useState(null);
      var selected = selectedState[0];
      var setSelected = selectedState[1];
      var tabState = React.useState("map");
      var tab = tabState[0], setTab = tabState[1];
      var renderer = React.useRef(null);
      var selectionVersion = React.useRef(0);
      var pointer = React.useRef(null);
      var help = React.useRef(null);
      var dismissed = React.useRef(false);
      var appearanceState = React.useState(false);
      var appearanceOpen = appearanceState[0], setAppearanceOpen = appearanceState[1];
      var appearancePanel = React.useRef(null);
      var appearanceButton = React.useRef(null);
      React.useEffect(function () {
        if (!open || !appearanceOpen) return undefined;
        var first = appearancePanel.current && appearancePanel.current.querySelector("input:checked");
        if (first) first.focus();
        function outside(event) {
          if (appearancePanel.current && !appearancePanel.current.contains(event.target)
              && appearanceButton.current && !appearanceButton.current.contains(event.target)) setAppearanceOpen(false);
        }
        window.addEventListener("pointerdown", outside);
        return function () { window.removeEventListener("pointerdown", outside); };
      }, [open, appearanceOpen]);
      React.useEffect(function () {
        return function () { if (configRequest.current) configRequest.current.abort(); };
      }, []);
      React.useEffect(function () {
        if (!open || typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
        var controller = new AbortController();
        setConfigBusy(true);
        readApi("/memory-engine/api/config", controller.signal).then(function (data) {
          if (!controller.signal.aborted) { setSettings(Object.assign({}, defaultSettings, data)); setConfigError(""); }
        }).catch(function (failure) {
          if (!controller.signal.aborted) setConfigError("读取配置失败：" + failure.message);
        }).finally(function () { if (!controller.signal.aborted) setConfigBusy(false); });
        return function () { controller.abort(); };
      }, [open]);
      function saveAppearance(changes) {
        if (configBusy || configRequest.current) return;
        if (Object.keys(changes).every(function (key) { return settings[key] === changes[key]; })) return;
        var previous = settings;
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 10000);
        configRequest.current = controller;
        setConfigBusy(true); setConfigError("");
        setSettings(Object.assign({}, settings, changes));
        requestApi("/memory-engine/api/config", { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes), signal: controller.signal }).then(function (data) {
            if (!controller.signal.aborted) setSettings(Object.assign({}, defaultSettings, data));
          }).catch(function (failure) {
            setSettings(previous);
            setConfigError("外观保存失败，已恢复原设置：" + (controller.signal.aborted ? "请求超时或已中断，请刷新确认状态" : failure.message));
          }).finally(function () { clearTimeout(timer); configRequest.current = null; setConfigBusy(false); });
      }
      function saveAutoMemory(enabled) {
        if (configRequest.current) return;
        var previous = settings;
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 10000);
        configRequest.current = controller;
        setConfigBusy(true); setConfigError(""); setCostHint(false);
        setSettings(Object.assign({}, settings, { autoMemory: Object.assign({}, settings.autoMemory, { enabled: enabled }) }));
        requestApi("/memory-engine/api/config", { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoMemory: { enabled: enabled } }), signal: controller.signal }).then(function (data) {
            setSettings(Object.assign({}, defaultSettings, data));
          }).catch(function (failure) {
            setSettings(previous);
            setConfigError("保存失败：" + (controller.signal.aborted ? "请求超时或已中断，请刷新确认状态" : failure.message));
          }).finally(function () { clearTimeout(timer); configRequest.current = null; setConfigBusy(false); });
      }
      function toggleAutoMemory() {
        if (configBusy) return;
        var enabled = settings.autoMemory && settings.autoMemory.enabled === true;
        setConfigError("");
        if (!enabled && settings.showAutoMemoryCostHint !== false) setCostHint(true);
        else saveAutoMemory(!enabled);
      }
      function useAutoImport() {
        if (configBusy || configRequest.current) return;
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 10000);
        configRequest.current = controller;
        setConfigBusy(true); setConfigError("");
        requestApi("/memory-engine/api/config", { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoImport: { sessionFilter: { mode: "auto" } } }), signal: controller.signal }).then(function (data) {
            setSettings(Object.assign({}, defaultSettings, data));
          }).catch(function (failure) {
            setConfigError("保存失败：" + (controller.signal.aborted ? "请求超时或已中断，请刷新确认状态" : failure.message));
          }).finally(function () { clearTimeout(timer); configRequest.current = null; setConfigBusy(false); });
      }
      function closeGuide() {
        dismissed.current = true;
        setGuideOpen(false);
        if (help.current) help.current.focus();
      }
      function openMap() {
        dismissed.current = false;
        setGuideOpen(false);
        setSelected(null);
        setAppearanceOpen(false);
        setTab("map");
        setOpen(Date.now());
      }
      function closeMap() { setSelected(null); setCostHint(false); setAppearanceOpen(false); setOpen(false); }
      function startPointer(event) {
        if (event.target.closest("[data-memory-engine-detail], [data-memory-engine-guide-layer], [data-memory-engine-controls], [data-memory-engine-appearance-panel]")) { pointer.current = null; return; }
        pointer.current = { x: event.clientX, y: event.clientY, moved: 0, version: selectionVersion.current };
      }
      function movePointer(event) {
        if (!pointer.current) return;
        pointer.current.moved += Math.abs(event.clientX - pointer.current.x) + Math.abs(event.clientY - pointer.current.y);
        pointer.current.x = event.clientX; pointer.current.y = event.clientY;
      }
      function dismissOutside() {
        var gesture = pointer.current;
        pointer.current = null;
        if (gesture && gesture.moved < 6 && gesture.version === selectionVersion.current) setSelected(null);
      }
      React.useEffect(function () {
        if (!open || typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
        var controller = new AbortController();
        var active = true;
        setGuideData(null);
        setGuideError("");
        readApi("/memory-engine/api/onboard", controller.signal).then(function (data) {
          if (typeof data.empty !== "boolean" || typeof data.prompt !== "string" || typeof data.dataDir !== "string"
              || !Array.isArray(data.steps) || data.steps.length !== 3
              || data.steps.some(function (step) { return !step || typeof step.title !== "string" || typeof step.body !== "string"; })) throw new Error("引导数据格式无效");
          if (!active) return;
          setGuideData(data);
          if (data.empty && settings.showGuideOnEmpty && !dismissed.current) setGuideOpen(true);
        }).catch(function (error) {
          if (active) setGuideError(error.message);
        });
        return function () { active = false; controller.abort(); };
      }, [open, retry, settings.showGuideOnEmpty]);
      React.useEffect(function () {
        if (!open || typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
        function onEscape() {
          if (guideOpen) closeGuide();
          else if (appearanceOpen) { setAppearanceOpen(false); if (appearanceButton.current) appearanceButton.current.focus(); }
          else if (selected) setSelected(null);
          else closeMap();
        }
        function onKey(event) {
          if (event.key !== "Escape") return;
          if (event.target && event.target.closest && event.target.closest("[data-memory-engine-confirm]")) return;
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) onEscape();
        }
        window.addEventListener("keydown", onKey, true);
        return function () { window.removeEventListener("keydown", onKey, true); };
      }, [open, guideOpen, selected, appearanceOpen]);
      var button = React.createElement("button", {
        type: "button",
        onClick: openMap,
        "data-memory-engine-map": "true",
        "aria-label": "打开记忆图谱",
        title: "记忆图谱",
        style: { display: "inline-flex", alignItems: "center", gap: "5px", padding: "5px 9px", borderRadius: "8px", border: "1px solid rgba(130,160,190,.4)", background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" },
      }, React.createElement("span", { "aria-hidden": "true" }, "🧠"), "记忆图谱");
      if (!open) return button;
      var overlay = React.createElement("div", {
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "记忆图谱",
        "data-memory-engine-theme": settings.graphTheme, "data-memory-engine-layout": settings.graphLayout,
        onPointerDownCapture: startPointer, onPointerMoveCapture: movePointer,
        onPointerCancelCapture: function () { pointer.current = null; }, onClick: dismissOutside,
        style: Object.assign({ position: "fixed", inset: 0, maxWidth: "none", maxHeight: "none", zIndex: 9999, background: "#03060c", colorScheme: settings.graphTheme === "paper" ? "light" : "dark" }, appearanceStyles[settings.graphTheme]),
      }, tab === "map" ? React.createElement(MemoryCanvas, { key: open, rendererRef: renderer, selectionVersion: selectionVersion, onSelect: setSelected,
        graphTheme: settings.graphTheme, graphLayout: settings.graphLayout })
        : tab === "memories" ? React.createElement(MemoryList, { onChanged: function () { setRetry(function (value) { return value + 1; }); } })
          : React.createElement(MemorySettings, { settings: settings, configBusy: configBusy, onToggle: toggleAutoMemory, onUseAutoImport: useAutoImport,
            onAppearanceChange: saveAppearance,
            onCleared: function () { openMap(); setGuideOpen(true); } }),
      tab !== "map" ? React.createElement("strong", { style: { position: "absolute", top: "23px", left: "24px", font: "600 18px system-ui,sans-serif", color: "#b7e9ff" } }, "记忆管理") : null,
      React.createElement("style", null, "@keyframes dsh-memory-detail-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}@media(prefers-reduced-motion:reduce){[data-memory-engine-detail]{animation:none!important}}"),
      React.createElement("div", {
        "data-memory-engine-controls": "true",
        style: { position: "absolute", top: "16px", right: "18px", zIndex: 1, display: "flex", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: "8px", rowGap: "8px", maxWidth: "calc(100% - 36px)" },
      }, React.createElement("div", { role: "tablist", "aria-label": "记忆面板", style: { display: "flex", gap: "4px", marginRight: "8px" } },
        [["map", "图谱"], ["memories", "记忆"], ["settings", "设置"]].map(function (entry) {
          return React.createElement("button", { key: entry[0], type: "button", role: "tab", "aria-selected": tab === entry[0], "data-memory-engine-tab": entry[0],
            onClick: function () { setSelected(null); setAppearanceOpen(false); setTab(entry[0]); },
            style: Object.assign({}, actionStyle, { background: tab === entry[0] ? "var(--memory-button,#204762)" : "var(--memory-panel,#091422)", borderColor: tab === entry[0] ? "var(--memory-accent,#8acded)" : "var(--memory-border,#35536b)" }) }, entry[1]);
        })), React.createElement("button", { ref: appearanceButton, type: "button", "data-memory-engine-appearance": "true", "aria-expanded": appearanceOpen,
          "aria-haspopup": "dialog", onClick: function () { setAppearanceOpen(!appearanceOpen); }, style: actionStyle }, "外观"),
        React.createElement(AutoMemoryToggle, { settings: settings, busy: configBusy, onToggle: toggleAutoMemory, location: "header" }), React.createElement("button", {
        ref: help, type: "button", onClick: function () { setGuideOpen(true); },
        "aria-label": "查看使用指南", title: "使用指南", style: actionStyle,
      }, "?"), React.createElement("button", {
        type: "button",
        onClick: closeMap,
        "aria-label": "关闭记忆图谱",
        title: "关闭（Esc）",
        style: Object.assign({}, closeStyle, { marginLeft: "4px" }),
      }, "关闭 ×")), appearanceOpen ? React.createElement("section", { ref: appearancePanel, role: "dialog", "aria-label": "外观", "data-memory-engine-appearance-panel": "true",
        style: { position: "absolute", top: "62px", right: "18px", zIndex: 3, boxSizing: "border-box", width: "min(380px,calc(100vw - 36px))", maxHeight: "calc(100vh - 90px)", overflowY: "auto",
          padding: "18px", border: "1px solid var(--memory-border,#3976a0)", borderRadius: "12px", background: "var(--memory-panel,#07111f)", boxShadow: "0 12px 35px #0004" } },
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", color: "var(--memory-text,#dbeaf8)" } },
          React.createElement("strong", null, "外观"), React.createElement("button", { type: "button", "aria-label": "关闭外观", style: closeStyle,
            onClick: function () { setAppearanceOpen(false); if (appearanceButton.current) appearanceButton.current.focus(); } }, "×")),
        React.createElement(AppearanceControls, { settings: settings, busy: configBusy, onChange: saveAppearance, location: "header" })) : null,
      configError ? React.createElement("p", { role: "alert", "data-memory-engine-config-error": "true",
        style: { position: "absolute", top: "50px", left: "18px", zIndex: 4, color: "#ff9c9c", background: "#271923", padding: "8px 12px", borderRadius: "8px", maxWidth: "min(600px,90vw)" } }, configError) : null,
      costHint ? React.createElement(ConfirmationDialog, { title: "开启自动记忆", message: "自动记忆会在每轮对话后调用一次模型，大约每轮几分钱。可以随时在这里关掉。实际费用以模型及计费方案为准。",
        submitLabel: "知道了，开启", busy: configBusy, onClose: function () { setCostHint(false); }, onConfirm: function () { saveAutoMemory(true); } }) : null,
      selected ? React.createElement(MemoryDetails, {
        node: selected, onClose: function () { setSelected(null); },
        onHighlight: function () { if (renderer.current) renderer.current.fireNeuron(selected.id); },
      }) : null, guideOpen ? React.createElement(GuideCard, {
        data: guideData, error: guideError, onClose: closeGuide, onRefresh: openMap,
        onRetry: function () { setRetry(function (value) { return value + 1; }); },
      }) : null);
      return React.createElement(React.Fragment, null, button, ReactDOM.createPortal(overlay, document.body));
    }

    function registerOn(slots, name, settings) {
      var disposable = null;
      slots.inject(name, function () {
        try {
          disposable = slots.register({
            name: name,
            id: "memory-engine-map",
            order: 50,
            label: function () { return "记忆图谱"; },
          }, function ConfiguredMemoryButton() { return React.createElement(MemoryButton, { settings: settings }); });
        } catch (error) {
          try { console.error("[dsh-memory-engine] 注册到 " + name + " 失败：", error); } catch (ignored) {}
        }
        return disposable;
      });
      return disposable;
    }

    function apply(ctx) {
      try {
        if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") {
          try { console.warn("[dsh-memory-engine] 宿主没有 slots 服务，跳过图谱按钮（记忆工具不受影响）"); } catch (ignored) {}
          return;
        }
        // 只注册第一个能用的插槽：优先 header.actions，老宿主没有就退到 views.actions
        var target = ctx.slots && typeof ctx.slots.has === "function" && !ctx.slots.has(SLOT_FALLBACKS[0])
          ? SLOT_FALLBACKS[1]
          : SLOT_NAME;
        function mount(settings) {
          if (!settings.hideButton) registerOn(ctx.slots, target, settings);
        }
        function fallback(error) {
          try { console.warn("[dsh-memory-engine] 配置读取失败，按默认显示按钮：", error); } catch (ignored) {}
          mount(defaultSettings);
        }
        try { loadSettings().then(mount, fallback); }
        catch (error) { fallback(error); }
      } catch (error) {
        try { console.error("[dsh-memory-engine] 插槽注册失败：", error); } catch (ignored) {}
      }
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
