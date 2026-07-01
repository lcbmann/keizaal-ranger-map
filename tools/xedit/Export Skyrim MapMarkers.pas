{
  Exports placed Skyrim map marker references to CSV.

  Usage:
  1. Copy this file into SSEEdit's "Edit Scripts" folder.
  2. Load Skyrim.esm and DLC masters in SSEEdit.
  3. Select the master files you want to scan.
  4. Right-click the selection, choose "Apply Script...", and select this script.
  5. The CSV is written to "Edit Scripts\skyrim-map-markers.csv".
}
unit UserScript;

var
  MarkerRows: TStringList;
  SeenFormIDs: TStringList;
  SelectedFiles: TStringList;
  ExportedCount: integer;

function CsvValue(value: string): string;
begin
  value := StringReplace(value, '"', '""', [rfReplaceAll]);
  Result := '"' + value + '"';
end;

function SafeElementValue(e: IInterface; path: string): string;
var
  el: IInterface;
begin
  Result := '';
  try
    el := ElementByPath(e, path);
    if Assigned(el) then
      Result := GetEditValue(el);
  except
    Result := '';
  end;
end;

function SafeLoadOrderFormID(e: IInterface): string;
begin
  Result := '';
  try
    Result := IntToHex(GetLoadOrderFormID(e), 8);
  except
    Result := IntToHex(FormID(e), 8);
  end;
end;

function Initialize: integer;
begin
  Result := 0;
  ExportedCount := 0;

  MarkerRows := TStringList.Create;
  SeenFormIDs := TStringList.Create;
  SelectedFiles := TStringList.Create;
  SeenFormIDs.Sorted := True;
  SeenFormIDs.Duplicates := dupIgnore;
  SelectedFiles.Sorted := True;
  SelectedFiles.Duplicates := dupIgnore;

  MarkerRows.Add(
    'form_id,file,editor_id,name,marker_type,marker_flags,x,y,z,cell,path'
  );
end;

function ExportMarker(e: IInterface): integer;
var
  base: IInterface;
  formID, baseEditorID, row, cellName: string;
  pos: TwbVector;
  x, y, z: string;
begin
  Result := 0;

  if Signature(e) <> 'REFR' then
    exit;

  base := BaseRecord(e);
  if not Assigned(base) then
    exit;

  baseEditorID := EditorID(base);
  if (baseEditorID <> 'MapMarker') and (FixedFormID(base) <> $00000010) then
    exit;

  formID := SafeLoadOrderFormID(e);
  if SeenFormIDs.IndexOf(formID) >= 0 then
    exit;
  SeenFormIDs.Add(formID);

  x := '';
  y := '';
  z := '';
  try
    pos := GetPosition(e);
    x := FloatToStr(pos.x);
    y := FloatToStr(pos.y);
    z := FloatToStr(pos.z);
  except
    x := SafeElementValue(e, 'DATA\Position\X');
    y := SafeElementValue(e, 'DATA\Position\Y');
    z := SafeElementValue(e, 'DATA\Position\Z');
  end;

  cellName := '';
  try
    cellName := Name(LinksTo(ElementBySignature(e, 'XCLC')));
  except
    cellName := '';
  end;

  row :=
    CsvValue(formID) + ',' +
    CsvValue(GetFileName(GetFile(e))) + ',' +
    CsvValue(SafeElementValue(e, 'EDID')) + ',' +
    CsvValue(SafeElementValue(e, 'FULL')) + ',' +
    CsvValue(SafeElementValue(e, 'TNAM')) + ',' +
    CsvValue(SafeElementValue(e, 'FNAM')) + ',' +
    CsvValue(x) + ',' +
    CsvValue(y) + ',' +
    CsvValue(z) + ',' +
    CsvValue(cellName) + ',' +
    CsvValue(FullPath(e));

  MarkerRows.Add(row);
  Inc(ExportedCount);
end;

function Finalize: integer;
var
  i, j: integer;
  f, base, ref: IInterface;
  filename: string;
begin
  Result := 0;

  base := nil;
  for i := 0 to FileCount - 1 do begin
    f := FileByIndex(i);
    try
      base := RecordByFormID(f, $00000010, True);
      if Assigned(base) and (EditorID(base) = 'MapMarker') then
        break;
    except
      base := nil;
    end;
  end;

  if not Assigned(base) then begin
    AddMessage('Could not find the MapMarker base object [STAT:00000010].');
  end else begin
    AddMessage('Found MapMarker base object. Exporting referenced placed markers...');
    BuildRef(base);

    for i := 0 to ReferencedByCount(base) - 1 do begin
      ref := ReferencedByIndex(base, i);
      if not Assigned(ref) then
        continue;
      if Signature(ref) <> 'REFR' then
        continue;
      if (SelectedFiles.Count > 0) and (SelectedFiles.IndexOf(GetFileName(GetFile(ref))) < 0) then
        continue;

      ExportMarker(ref);
    end;
  end;

  filename := ScriptsPath + 'skyrim-map-markers.csv';
  AddMessage('Saving Skyrim map marker export to ' + filename);
  AddMessage('Exported map markers: ' + IntToStr(ExportedCount));
  MarkerRows.SaveToFile(filename);
  MarkerRows.Free;
  SeenFormIDs.Free;
  SelectedFiles.Free;
end;

function Process(e: IInterface): integer;
begin
  Result := 0;
  try
    if GetFileName(e) <> '' then
      SelectedFiles.Add(GetFileName(e));
  except
  end;
end;

end.
