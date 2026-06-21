import sqlite3
import json
import sys
import os
import re

sys.stdout.reconfigure(encoding='utf-8')

def parse_varint(data, pos):
    val = 0
    shift = 0
    while True:
        if pos >= len(data):
            return None, pos
        b = data[pos]
        val |= (b & 0x7f) << shift
        pos += 1
        if not (b & 0x80):
            break
        shift += 7
    return val, pos

def is_highly_printable_string(val):
    try:
        decoded = val.decode('utf-8')
        # Strip ANSI escape sequences (colors, styles)
        ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        cleaned = ansi_escape.sub('', decoded)
        
        control_count = 0
        for c in cleaned:
            o = ord(c)
            if o < 32 and o not in [9, 10, 13]:
                control_count += 1
        if len(cleaned) > 0 and (control_count / len(cleaned)) < 0.02:
            return True, decoded
        return False, None
    except Exception:
        return False, None

def decode_protobuf(data, pos=0, end=None):
    if end is None:
        end = len(data)
    
    result = {}
    while pos < end:
        key, pos = parse_varint(data, pos)
        if key is None:
            break
        
        field_num = key >> 3
        wire_type = key & 0x07
        
        if wire_type == 0:  # Varint
            val, pos = parse_varint(data, pos)
            if val is None:
                break
            if field_num not in result:
                result[field_num] = []
            result[field_num].append(val)
            
        elif wire_type == 1:  # 64-bit
            if pos + 8 > end:
                break
            val = data[pos:pos+8]
            pos += 8
            if field_num not in result:
                result[field_num] = []
            result[field_num].append(f"HEX:{val.hex()}")
            
        elif wire_type == 2:  # Length-delimited
            length, pos = parse_varint(data, pos)
            if length is None or pos + length > end:
                break
            val = data[pos:pos+length]
            pos += length
            
            # Check if it is a printable string first to avoid false-positive sub-message parsing
            is_str, decoded_str = is_highly_printable_string(val)
            if is_str:
                decoded_val = decoded_str
            else:
                try:
                    sub_msg = decode_protobuf(val, 0, len(val))
                    if sub_msg and all(isinstance(k, int) and 0 < k < 10000 for k in sub_msg.keys()):
                        decoded_val = sub_msg
                    else:
                        raise Exception()
                except Exception:
                    decoded_val = f"HEX:{val.hex()}"
            
            if field_num not in result:
                result[field_num] = []
            result[field_num].append(decoded_val)
            
        elif wire_type == 5:  # 32-bit
            if pos + 4 > end:
                break
            val = data[pos:pos+4]
            pos += 4
            if field_num not in result:
                result[field_num] = []
            result[field_num].append(f"HEX:{val.hex()}")
        else:
            break
            
    return result

def get_nested(d, keys):
    curr = d
    for k in keys:
        if isinstance(curr, dict) and k in curr:
            curr = curr[k]
        elif isinstance(curr, list) and isinstance(k, int) and 0 <= k < len(curr):
            curr = curr[k]
        else:
            return None
    return curr

def find_all_strings_in_dict(d):
    strings = []
    if isinstance(d, dict):
        for v in d.values():
            strings.extend(find_all_strings_in_dict(v))
    elif isinstance(d, list):
        for item in d:
            strings.extend(find_all_strings_in_dict(item))
    elif isinstance(d, str):
        if not d.startswith("HEX:"):
            strings.append(d)
    return strings

def parse_sqlite_db(db_path):
    if not os.path.exists(db_path):
        return {"error": f"File not found: {db_path}"}
        
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        
        # Check tables
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in cur.fetchall()]
        if "steps" not in tables:
            conn.close()
            return {"error": "steps table not found in database"}
            
        cur.execute("SELECT idx, step_type, status, step_payload FROM steps ORDER BY idx")
        rows = cur.fetchall()
        
        messages = []
        tool_map = {}
        session_id = os.path.basename(db_path).replace(".db", "")
        summary = "Active Workspace Session"
        
        for idx, step_type, status, payload in rows:
            if not payload:
                continue
                
            decoded = decode_protobuf(payload)
            
            # User input / System init
            if step_type == 14:
                user_text = get_nested(decoded, [19, 0, 2, 0])
                if not user_text:
                    v19 = decoded.get(19, [])
                    strs = find_all_strings_in_dict(v19)
                    if strs:
                        user_text = max(strs, key=len)
                
                if user_text and len(user_text.strip()) > 0:
                    messages.append({
                        "role": "User",
                        "text": user_text.strip(),
                        "idx": idx,
                        "timestamp": None
                    })
                    
            # Agent response turn
            elif step_type == 15:
                agent_text = get_nested(decoded, [20, 0, 3, 0])
                if not agent_text:
                    v20 = decoded.get(20, [])
                    strs = find_all_strings_in_dict(v20)
                    strs = [s for s in strs if not (s.startswith('{') or s.startswith('[')) and len(s) > 15]
                    if strs:
                        agent_text = max(strs, key=len)
                
                # Extract tool calls
                tools = []
                v20_list = decoded.get(20, [])
                for item in v20_list:
                    if isinstance(item, dict) and 7 in item:
                        t_item = get_nested(item, [7, 0])
                        if t_item:
                            t_id = get_nested(t_item, [1, 0])
                            t_name = get_nested(t_item, [2, 0])
                            t_args_str = get_nested(t_item, [3, 0])
                            
                            t_args = {}
                            if t_args_str:
                                try:
                                    t_args = json.loads(t_args_str)
                                except Exception:
                                    t_args = {"raw": t_args_str}
                                    
                            tool_obj = {
                                "id": t_id,
                                "name": t_name,
                                "args": t_args,
                                "status": "pending",
                                "output": ""
                            }
                            tools.append(tool_obj)
                            if t_id:
                                tool_map[t_id] = tool_obj
                                
                if (agent_text and len(agent_text.strip()) > 0) or tools:
                    messages.append({
                        "role": "Agent",
                        "text": agent_text.strip() if agent_text else "",
                        "tools": tools,
                        "idx": idx,
                        "timestamp": None
                    })
                    
            # Tool output step
            elif step_type == 21:
                t_id = get_nested(decoded, [5, 0, 4, 0, 1, 0])
                output_text = get_nested(decoded, [28, 0, 21, 0, 1, 0])
                if not output_text:
                    v28 = decoded.get(28, [])
                    strs = find_all_strings_in_dict(v28)
                    if strs:
                        output_text = max(strs, key=len)
                        
                if t_id and t_id in tool_map:
                    tool_obj = tool_map[t_id]
                    tool_obj["status"] = "success" if status == 3 else "failed"
                    if output_text:
                        tool_obj["output"] = output_text
                        
        conn.close()
        
        # Deduce title from the first User message if possible
        for m in messages:
            if m["role"] == "User" and m["text"] and len(m["text"]) > 0:
                summary = m["text"]
                if len(summary) > 80:
                    summary = summary[:77] + "..."
                break
                
        return {"id": session_id, "summary": summary, "messages": messages}
    except Exception as e:
        return {"error": f"Error parsing database: {str(e)}"}

def parse_sqlite_db_meta(db_path):
    if not os.path.exists(db_path):
        return {"error": f"File not found: {db_path}"}
        
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        
        # Check tables
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in cur.fetchall()]
        if "steps" not in tables:
            conn.close()
            return {"error": "steps table not found in database"}
            
        # Try to get the first User message (step_type = 14) for the summary/title
        cur.execute("SELECT step_payload FROM steps WHERE step_type = 14 ORDER BY idx LIMIT 1")
        row = cur.fetchone()
        
        summary = "Active Workspace Session"
        if row and row[0]:
            decoded = decode_protobuf(row[0])
            user_text = get_nested(decoded, [19, 0, 2, 0])
            if not user_text:
                v19 = decoded.get(19, [])
                strs = find_all_strings_in_dict(v19)
                if strs:
                    user_text = max(strs, key=len)
            if user_text and len(user_text.strip()) > 0:
                summary = user_text.strip()
                if len(summary) > 80:
                    summary = summary[:77] + "..."
                    
        conn.close()
        session_id = os.path.basename(db_path).replace(".db", "")
        return {"id": session_id, "summary": summary}
    except Exception as e:
        return {"error": f"Error parsing database metadata: {str(e)}"}

def parse_sqlite_dir_meta(dir_path):
    if not os.path.exists(dir_path):
        return {"error": f"Directory not found: {dir_path}"}
        
    results = []
    try:
        for f in os.listdir(dir_path):
            if f.endswith(".db"):
                full_path = os.path.join(dir_path, f)
                stat = os.stat(full_path)
                meta = parse_sqlite_db_meta(full_path)
                if "error" not in meta:
                    meta["date"] = stat.st_mtime * 1000  # JS epoch millis
                    meta["size"] = stat.st_size
                    meta["file"] = full_path
                    results.append(meta)
        return results
    except Exception as e:
        return {"error": f"Error scanning directory: {str(e)}"}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No parameters provided"}))
        sys.exit(1)
        
    meta_only = False
    scan_dir = False
    target_path = None
    
    for arg in sys.argv[1:]:
        if arg == "--meta":
            meta_only = True
        elif arg == "--scan":
            scan_dir = True
        else:
            target_path = arg
            
    if not target_path:
        print(json.dumps({"error": "No database or directory path provided"}))
        sys.exit(1)
        
    if scan_dir:
        result = parse_sqlite_dir_meta(target_path)
    elif meta_only:
        result = parse_sqlite_db_meta(target_path)
    else:
        result = parse_sqlite_db(target_path)
        
    print(json.dumps(result, ensure_ascii=False))

