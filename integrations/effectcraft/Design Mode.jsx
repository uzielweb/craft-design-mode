(function (thisObj) {
    var PANEL_NAME = "Design Mode";

    function buildUI(container) {
        var win = (container instanceof Panel)
            ? container
            : new Window("palette", PANEL_NAME, undefined, { resizeable: true });

        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 8;
        win.margins = 10;

        var header = win.add("statictext", undefined, "Design Mode — Vector Suite");

        // --- Parametric Ellipse / Arc Donut ---
        var pEllipse = win.add("panel", undefined, "Parametric Ellipse / Arc");
        pEllipse.orientation = "column";
        pEllipse.alignChildren = ["fill", "top"];
        pEllipse.spacing = 6;
        pEllipse.margins = 10;

        var rowR = pEllipse.add("group");
        rowR.add("statictext", undefined, "Rx:");
        var inRx = rowR.add("edittext", undefined, "120");
        inRx.characters = 5;
        rowR.add("statictext", undefined, "Ry:");
        var inRy = rowR.add("edittext", undefined, "120");
        inRy.characters = 5;

        var rowH = pEllipse.add("group");
        rowH.add("statictext", undefined, "Start:");
        var inStart = rowH.add("edittext", undefined, "-90");
        inStart.characters = 4;
        rowH.add("statictext", undefined, "Sweep:");
        var inSweep = rowH.add("edittext", undefined, "300");
        inSweep.characters = 4;
        rowH.add("statictext", undefined, "Ratio:");
        var inHole = rowH.add("edittext", undefined, "0.45");
        inHole.characters = 4;

        var btnCreateArc = pEllipse.add("button", undefined, "Create DM Ellipse / Arc");
        btnCreateArc.onClick = function () {
            var comp = ensureComp();
            if (!comp) return;
            var rx = Math.max(4, parseFloat(inRx.text) || 120);
            var ry = Math.max(4, parseFloat(inRy.text) || 120);
            var hole = Math.max(0, Math.min(0.95, parseFloat(inHole.text) || 0));
            var startDeg = parseFloat(inStart.text);
            if (isNaN(startDeg)) startDeg = -90;
            var sweep = Math.max(1, Math.min(360, parseFloat(inSweep.text) || 360));

            app.beginUndoGroup("Design Mode: Create DM Ellipse");
            try {
                var shapeLayer = comp.layers.addShape();
                shapeLayer.name = "DM Ellipse " + Math.round(sweep) + "deg";
                var rootGroup = shapeLayer.property("ADBE Root Vectors Group");
                var vecGroup = rootGroup.addProperty("ADBE Vector Group");
                vecGroup.name = "Parametric Contour";
                var contents = vecGroup.property("ADBE Vectors Group");

                var outer = buildArcShape(rx, ry, startDeg, startDeg + sweep, sweep >= 359.99, false);
                var pathProp = contents.addProperty("ADBE Vector Shape - Group");
                pathProp.property("ADBE Vector Shape").setValue(outer);

                if (hole > 0.01) {
                    var inner = buildArcShape(rx * hole, ry * hole, startDeg, startDeg + sweep, sweep >= 359.99, true);
                    var innerProp = contents.addProperty("ADBE Vector Shape - Group");
                    innerProp.property("ADBE Vector Shape").setValue(inner);
                }

                var fill = contents.addProperty("ADBE Vector Graphic - Fill");
                fill.property("ADBE Vector Fill Color").setValue([0.31, 0.55, 1.0, 1.0]);
                var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
                stroke.property("ADBE Vector Stroke Color").setValue([0.9, 0.94, 0.98, 1.0]);
                stroke.property("ADBE Vector Stroke Width").setValue(3);
            } finally {
                app.endUndoGroup();
            }
        };

        // --- Transform (Keyframe-safe) ---
        var pTr = win.add("panel", undefined, "Transform (Keyframe-Safe)");
        pTr.orientation = "column";
        pTr.alignChildren = ["fill", "top"];
        pTr.spacing = 6;
        pTr.margins = 10;

        var rowOff = pTr.add("group");
        rowOff.add("statictext", undefined, "dX:");
        var inDx = rowOff.add("edittext", undefined, "0");
        inDx.characters = 5;
        rowOff.add("statictext", undefined, "dY:");
        var inDy = rowOff.add("edittext", undefined, "0");
        inDy.characters = 5;
        rowOff.add("statictext", undefined, "Rot:");
        var inRot = rowOff.add("edittext", undefined, "0");
        inRot.characters = 4;

        var btnApplyTr = pTr.add("button", undefined, "Apply Transform Delta");
        btnApplyTr.onClick = function () {
            var comp = getActiveComp();
            if (!comp || comp.selectedLayers.length === 0) {
                alert("Select at least one layer in the active composition.");
                return;
            }
            var dx = parseFloat(inDx.text) || 0;
            var dy = parseFloat(inDy.text) || 0;
            var drot = parseFloat(inRot.text) || 0;

            app.beginUndoGroup("Design Mode: Transform Delta");
            try {
                for (var i = 0; i < comp.selectedLayers.length; i++) {
                    var lyr = comp.selectedLayers[i];
                    var tr = lyr.property("ADBE Transform Group");
                    var posProp = tr.property("ADBE Position");
                    var rotProp = tr.property("ADBE Rotate Z");

                    var curPos = posProp.valueAtTime(comp.time, false);
                    var nextPos = [curPos[0] + dx, curPos[1] + dy];
                    if (posProp.numKeys > 0) {
                        posProp.setValueAtTime(comp.time, nextPos);
                    } else {
                        posProp.setValue(nextPos);
                    }

                    if (drot !== 0) {
                        var curRot = rotProp.valueAtTime(comp.time, false);
                        var nextRot = curRot + drot;
                        if (rotProp.numKeys > 0) {
                            rotProp.setValueAtTime(comp.time, nextRot);
                        } else {
                            rotProp.setValue(nextRot);
                        }
                    }
                }
            } finally {
                app.endUndoGroup();
            }
        };

        // --- Align Selected Layers ---
        var pAlign = win.add("panel", undefined, "Align to Comp");
        pAlign.orientation = "row";
        pAlign.alignChildren = ["fill", "center"];
        pAlign.spacing = 4;
        pAlign.margins = 8;

        var alignModes = [
            { label: "L", mode: "left" },
            { label: "HC", mode: "hcenter" },
            { label: "R", mode: "right" },
            { label: "T", mode: "top" },
            { label: "VC", mode: "vcenter" },
            { label: "B", mode: "bottom" }
        ];
        for (var a = 0; a < alignModes.length; a++) {
            (function (item) {
                var b = pAlign.add("button", undefined, item.label);
                b.preferredSize = [32, 24];
                b.onClick = function () { alignSelection(item.mode); };
            })(alignModes[a]);
        }

        // --- Operators & Style Quick Actions ---
        var pOps = win.add("panel", undefined, "Operators & Style");
        pOps.orientation = "row";
        pOps.alignChildren = ["fill", "center"];
        pOps.spacing = 4;
        pOps.margins = 8;

        var btnAddTrim = pOps.add("button", undefined, "+Trim");
        btnAddTrim.onClick = function () { addShapeOperator("ADBE Vector Filter - Trim"); };
        var btnAddRep = pOps.add("button", undefined, "+Repeat");
        btnAddRep.onClick = function () { addShapeOperator("ADBE Vector Filter - Repeater"); };
        var btnAddOffset = pOps.add("button", undefined, "+Offset");
        btnAddOffset.onClick = function () { addShapeOperator("ADBE Vector Filter - Offset"); };
        var btnAddRound = pOps.add("button", undefined, "+Round");
        btnAddRound.onClick = function () { addShapeOperator("ADBE Vector Filter - RC"); };

        // --- Studio Web Bridge ---
        var btnStudio = win.add("button", undefined, "Open Full Canvas Studio (Browser)");
        btnStudio.onClick = function () {
            if (typeof system !== "undefined" && typeof system.callSystem === "function") {
                system.callSystem("cmd /c start http://127.0.0.1:4173");
            } else {
                alert("Open http://127.0.0.1:4173 in your browser while the Design Mode bridge is running.");
            }
        };

        win.layout.layout(true);
        win.onResizing = win.onResize = function () {
            this.layout.resize();
        };
        return win;
    }

    function getActiveComp() {
        if (!app.project || !app.project.activeItem) return null;
        if (app.project.activeItem instanceof CompItem) return app.project.activeItem;
        return null;
    }

    function ensureComp() {
        var comp = getActiveComp();
        if (comp) return comp;
        return app.project.items.addComp("Design Mode Comp", 1280, 720, 1, 10, 30);
    }

    function alignSelection(mode) {
        var comp = getActiveComp();
        if (!comp || comp.selectedLayers.length === 0) return;
        app.beginUndoGroup("Design Mode: Align " + mode);
        try {
            for (var i = 0; i < comp.selectedLayers.length; i++) {
                var lyr = comp.selectedLayers[i];
                var posProp = lyr.property("ADBE Transform Group").property("ADBE Position");
                var pos = posProp.valueAtTime(comp.time, false);
                var nx = pos[0];
                var ny = pos[1];
                if (mode === "left") nx = 100;
                else if (mode === "hcenter") nx = comp.width / 2;
                else if (mode === "right") nx = comp.width - 100;
                else if (mode === "top") ny = 100;
                else if (mode === "vcenter") ny = comp.height / 2;
                else if (mode === "bottom") ny = comp.height - 100;
                if (posProp.numKeys > 0) posProp.setValueAtTime(comp.time, [nx, ny]);
                else posProp.setValue([nx, ny]);
            }
        } finally {
            app.endUndoGroup();
        }
    }

    function addShapeOperator(matchName) {
        var comp = getActiveComp();
        if (!comp || comp.selectedLayers.length === 0) {
            alert("Select at least one Shape Layer.");
            return;
        }
        app.beginUndoGroup("Design Mode: Add Operator");
        try {
            for (var i = 0; i < comp.selectedLayers.length; i++) {
                var rootGroup = comp.selectedLayers[i].property("ADBE Root Vectors Group");
                if (rootGroup && rootGroup.canAddProperty(matchName)) {
                    rootGroup.addProperty(matchName);
                }
            }
        } finally {
            app.endUndoGroup();
        }
    }

    function buildArcShape(rx, ry, startDeg, endDeg, closed, reverse) {
        var totalRad = ((endDeg - startDeg) * Math.PI) / 180;
        var segs = Math.max(1, Math.ceil(Math.abs(totalRad) / (Math.PI / 2)));
        var step = totalRad / segs;
        var startRad = (startDeg * Math.PI) / 180;
        var count = closed ? segs : segs + 1;
        var k = (4 / 3) * Math.tan(Math.abs(step) / 4);

        var verts = [];
        var inT = [];
        var outT = [];

        for (var i = 0; i < count; i++) {
            var idx = reverse ? (count - 1 - i) : i;
            var theta = startRad + idx * step;
            var x = Math.cos(theta) * rx;
            var y = Math.sin(theta) * ry;
            var tx = -Math.sin(theta) * rx * (reverse ? -1 : 1);
            var ty = Math.cos(theta) * ry * (reverse ? -1 : 1);

            verts.push([x, y]);
            inT.push((i === 0 && !closed) ? [0, 0] : [-tx * k, -ty * k]);
            outT.push((i === count - 1 && !closed) ? [0, 0] : [tx * k, ty * k]);
        }

        var sh = new Shape();
        sh.vertices = verts;
        sh.inTangents = inT;
        sh.outTangents = outT;
        sh.closed = closed;
        return sh;
    }

    var built = buildUI(thisObj);
    if (built instanceof Window) {
        built.center();
        built.show();
    }
})(this);
