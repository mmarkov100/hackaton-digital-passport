package com.example.demo;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api")
public class PassportApi {
    private static final String CUSTOMER_ORG = "ORG-CUSTOMER";
    private static final String FACTORY_ORG = "ORG-URAL";
    private static final Pattern ELEMENT = Pattern.compile("^#(\\d+)\\s*=\\s*IFC(COLUMN|BEAM|SLAB|WALL|FOOTING|REINFORCINGBAR|OPENINGELEMENT|DOOR|WINDOW|ROOF|STAIRFLIGHT|RAILING)\\('([^']+)',[^,]*,('(?:[^']|'')*'|\\$)", Pattern.CASE_INSENSITIVE);
    private static final Set<String> PASSPORT_TYPES = Set.of("COLUMN", "BEAM", "SLAB", "WALL", "FOOTING");
    private static final Pattern STOREY = Pattern.compile("^#(\\d+)\\s*=\\s*IFCBUILDINGSTOREY\\('(?:[^']|'')*',[^,]*,'((?:[^']|'')*)'", Pattern.CASE_INSENSITIVE);
    private static final Pattern UNICODE = Pattern.compile("\\\\X2\\\\([0-9A-Fa-f]+)\\\\X0\\\\");
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    @Value("${passport.customer-password:demo123}") private String customerPassword;
    @Value("${passport.factory-password:demo123}") private String factoryPassword;

    public PassportApi(JdbcTemplate jdbc, ObjectMapper mapper) { this.jdbc = jdbc; this.mapper = mapper; }
    private record Session(String role, String actor, String org, Instant created) {}
    public record LoginRequest(String role, String password) {}

    @PostMapping("/login")
    public Map<String, String> login(@RequestBody LoginRequest request, HttpServletResponse response) {
        String role = request.role();
        String password = request.password();
        if (!("customer".equals(role) && customerPassword.equals(password) || "factory".equals(role) && factoryPassword.equals(password)))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Неверные учётные данные");
        String token = UUID.randomUUID().toString();
        Session session = "customer".equals(role)
            ? new Session(role, "USER-CUSTOMER", CUSTOMER_ORG, Instant.now())
            : new Session(role, "USER-FACTORY", FACTORY_ORG, Instant.now());
        sessions.put(token, session);
        Cookie cookie = new Cookie("passport_session", token);
        cookie.setHttpOnly(true); cookie.setPath("/"); cookie.setAttribute("SameSite", "Lax");
        response.addCookie(cookie);
        return Map.of("role", role, "actor", session.actor());
    }

    @PostMapping("/logout")
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        if (request.getCookies() != null) for (Cookie cookie : request.getCookies())
            if ("passport_session".equals(cookie.getName())) sessions.remove(cookie.getValue());
        Cookie cookie = new Cookie("passport_session", ""); cookie.setMaxAge(0); cookie.setPath("/"); response.addCookie(cookie);
    }

    private Session session(HttpServletRequest request) {
        if (request.getCookies() != null) for (Cookie cookie : request.getCookies()) {
            if ("passport_session".equals(cookie.getName())) {
                Session session = sessions.get(cookie.getValue());
                if (session != null) return session;
            }
        }
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Войдите в систему");
    }
    private Session customer(HttpServletRequest request) {
        Session session = session(request);
        if (!"customer".equals(session.role())) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        return session;
    }
    private Map<String, Object> row(String id, Session session) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM passport_projects WHERE id=?", id);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        Map<String, Object> row = rows.get(0);
        if (!session.org().equals(row.get("customer_org")) && !session.org().equals(row.get("factory_org")))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        if ("factory".equals(session.role()) && !visibleToFactory((String) row.get("body")))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        return row;
    }
    private boolean visibleToFactory(String body) {
        try {
            JsonNode project = mapper.readTree(body);
            for (JsonNode order : project.path("orders"))
                if (FACTORY_ORG.equals(order.path("factoryOrgId").asText()) && !"Черновик".equals(order.path("status").asText())) return true;
            JsonNode order = project.path("order");
            return FACTORY_ORG.equals(order.path("factoryOrgId").asText()) && !"Черновик".equals(order.path("status").asText());
        } catch (Exception ignored) { return false; }
    }

    @GetMapping("/projects")
    public Map<String, JsonNode> projects(HttpServletRequest request) throws Exception {
        Session session = session(request);
        Map<String, JsonNode> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList("SELECT * FROM passport_projects WHERE customer_org=? OR factory_org=? ORDER BY id", session.org(), session.org())) {
            String body = (String) row.get("body");
            if ("factory".equals(session.role()) && !visibleToFactory(body)) continue;
            result.put((String) row.get("id"), mapper.readTree(body));
        }
        return result;
    }

    @PutMapping("/projects/{id}")
    public Map<String, Object> save(@PathVariable String id, @RequestBody JsonNode body, HttpServletRequest request) throws Exception {
        Session session = session(request);
        if (!id.matches("[A-Za-z0-9_-]{1,80}") || !id.equals(body.path("projectId").asText()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Некорректный ID проекта");
        String customerOrg = body.path("customerOrgId").asText(CUSTOMER_ORG);
        String factoryOrg = body.path("order").path("factoryOrgId").asText(FACTORY_ORG);
        if (!CUSTOMER_ORG.equals(customerOrg) || !FACTORY_ORG.equals(factoryOrg))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Неизвестная организация");
        checkShipments(body);
        List<Map<String, Object>> old = jdbc.queryForList("SELECT * FROM passport_projects WHERE id=?", id);
        if (old.isEmpty()) {
            customer(request);
            jdbc.update("INSERT INTO passport_projects(id,customer_org,factory_org,body) VALUES (?,?,?,?)", id, customerOrg, factoryOrg, mapper.writeValueAsString(body));
            audit(id, session, "project.create", "Создан проект");
        } else {
            row(id, session);
            {
                JsonNode before = mapper.readTree((String) old.get(0).get("body"));
                checkEvents(before, body, session);
                checkDocuments(before, body);
                if ("customer".equals(session.role())) checkCustomerChanges(before, body);
                if ("factory".equals(session.role())) {
                if (!before.path("project").equals(body.path("project")) || !before.path("address").equals(body.path("address"))
                    || !before.path("customerOrgId").equals(body.path("customerOrgId")) || !before.path("version").equals(body.path("version")))
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Проектные данные может менять только ТХЗ");
                checkFactoryChanges(before, body);
                }
            }
            jdbc.update("UPDATE passport_projects SET body=?,revision=revision+1,updated_at=NOW() WHERE id=?", mapper.writeValueAsString(body), id);
            audit(id, session, "project.update", "Обновлены данные проекта");
        }
        return Map.of("id", id, "saved", true);
    }
    private void checkFactoryChanges(JsonNode before, JsonNode after) {
        Map<String, JsonNode> incomingItems = new HashMap<>();
        for (JsonNode item : after.path("items")) incomingItems.put(item.path("id").asText(), item);
        if (incomingItems.size() != before.path("items").size())
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Состав проекта может менять только ТХЗ");
        for (JsonNode item : before.path("items")) {
            JsonNode changed = incomingItems.get(item.path("id").asText());
            if (changed == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Конструкция удалена");
            for (String field : List.of("id", "globalId", "expressId", "ifcVersion", "ifcName", "ifcType", "mark", "floor"))
                if (!item.path(field).equals(changed.path(field)))
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Проектные параметры может менять только ТХЗ");
            if (item.path("physical").equals(changed.path("physical")))
                for (String field : List.of("receipt", "quality"))
                    if (!item.path(field).equals(changed.path(field)))
                        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Получение и приёмка доступны только ТХЗ");
        }
        Map<String, JsonNode> incomingDocs = new HashMap<>();
        for (JsonNode doc : after.path("docs")) incomingDocs.put(doc.path("id").asText(), doc);
        for (JsonNode doc : before.path("docs"))
            if ("ТХЗ".equals(doc.path("source").asText()) && !doc.equals(incomingDocs.get(doc.path("id").asText())))
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Проектный документ может менять только ТХЗ");
        Map<String, JsonNode> incomingOrders = new HashMap<>();
        for (JsonNode order : after.path("orders")) incomingOrders.put(order.path("id").asText(), order);
        if (incomingOrders.size() != before.path("orders").size())
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Заказ может создавать только ТХЗ");
        for (JsonNode order : before.path("orders")) {
            JsonNode changed = incomingOrders.get(order.path("id").asText());
            if (changed == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Заказ удалён");
            for (String field : List.of("id", "number", "itemIds", "projectDocIds", "ifcVersion", "customerOrgId", "factoryOrgId", "receiverOrgId"))
                if (!order.path(field).equals(changed.path(field)))
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Состав и документы заказа может менять только ТХЗ");
        }
    }
    private void checkCustomerChanges(JsonNode before, JsonNode after) {
        Map<String, JsonNode> incoming = new HashMap<>();
        for (JsonNode item : after.path("items")) incoming.put(item.path("id").asText(), item);
        for (JsonNode item : before.path("items")) {
            JsonNode changed = incoming.get(item.path("id").asText());
            if (changed == null) continue;
            if (!"Ожидается".equals(item.path("receipt").asText()) && !item.path("receipt").equals(changed.path("receipt")))
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Получение уже подтверждено");
            for (String field : List.of("factory", "physical", "batch", "production", "marked", "manufacturedAt", "manufacturingRequirements", "manufacturedBy", "qualityDoc", "test", "sent"))
                if (!item.path(field).equals(changed.path(field)))
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Производственные данные может менять только завод");
        }
    }
    private void checkEvents(JsonNode before, JsonNode after, Session session) {
        List<JsonNode> previous = new ArrayList<>();
        List<JsonNode> current = new ArrayList<>();
        before.path("events").forEach(previous::add);
        after.path("events").forEach(current::add);
        if (current.size() < previous.size()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Историю нельзя удалять");
        int added = current.size() - previous.size();
        for (int i=0; i<previous.size(); i++)
            if (!previous.get(i).equals(current.get(i + added)))
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Историю нельзя изменять");
        for (int i=0; i<added; i++) {
            JsonNode event = current.get(i);
            if (!session.org().equals(event.path("orgId").asText()) || !session.actor().equals(event.path("userId").asText()))
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Автор события не совпадает с аккаунтом");
            String action = event.path("action").asText("");
            if (!action.isEmpty() && !("customer".equals(session.role()) ? CUSTOMER_ACTIONS : FACTORY_ACTIONS).contains(action))
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Действие недоступно роли");
        }
    }
    private void checkDocuments(JsonNode before, JsonNode after) {
        Map<String, JsonNode> incoming = new HashMap<>();
        for (JsonNode doc : after.path("docs")) incoming.put(doc.path("id").asText(), doc);
        for (JsonNode doc : before.path("docs")) {
            JsonNode changed = incoming.get(doc.path("id").asText());
            if (changed == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Документ нельзя удалять");
            for (String field : List.of("id", "name", "kind", "version", "type", "source", "itemIds", "physicalIds", "fileId"))
                if (!doc.path(field).equals(changed.path(field)))
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Подтверждённый документ нельзя перезаписывать");
        }
    }
    private void checkShipments(JsonNode project) {
        Set<String> active = new HashSet<>();
        for (JsonNode shipment : project.path("shipments")) {
            if (!"ORG-CUSTOMER".equals(shipment.path("receiverOrgId").asText("ORG-CUSTOMER")))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Неверный получатель отгрузки");
            for (JsonNode id : shipment.path("ids")) {
                String itemId = id.asText();
                if (!shipment.path("archived").has(itemId) && !active.add(itemId))
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "Изделие уже включено в активную отгрузку");
            }
        }
    }
    private static final Set<String> CUSTOMER_ACTIONS = Set.of("project.create", "project.import", "order.create", "order.change", "order.cancel", "order.respond", "document.upload", "document.verify", "receipt.confirm", "quality.decide", "issue.create", "issue.close", "issue.reopen", "replacement.resolve");
    private static final Set<String> FACTORY_ACTIONS = Set.of("order.confirm", "order.clarify", "order.reject", "order.change", "order.cancel", "order.respond", "document.upload", "production.register", "production.manufacture", "production.ready", "production.materials", "test.add", "shipment.create", "issue.answer", "replacement.request", "replacement.apply", "mark.restore");
    private void audit(String id, Session session, String action, String details) {
        jdbc.update("INSERT INTO passport_audit(project_id,actor,organization,action,details) VALUES (?,?,?,?,?)",
            id, session.actor(), session.org(), action, details);
    }

    @PostMapping(value="/projects/{id}/ifc/preview", consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> preview(@PathVariable String id, @RequestPart("file") MultipartFile file, HttpServletRequest request) throws Exception {
        customer(request); row(id, session(request));
        if (file.isEmpty() || file.getSize() > 100L * 1024 * 1024 || !Objects.requireNonNullElse(file.getOriginalFilename(), "").toLowerCase(Locale.ROOT).endsWith(".ifc"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Нужен IFC-файл до 100 МБ");
        Map<String, Object> parsed = parseIfc(file.getInputStream(), false);
        @SuppressWarnings("unchecked") List<Map<String, String>> elements = (List<Map<String, String>>) parsed.get("elements");
        @SuppressWarnings("unchecked") Map<String, Integer> counts = (Map<String, Integer>) parsed.get("counts");
        UUID modelId = UUID.randomUUID();
        jdbc.update("INSERT INTO passport_ifc_versions(id,project_id,file_name,body,actor) VALUES (?,?,?,?,?)",
            modelId, id, file.getOriginalFilename(), file.getBytes(), session(request).actor());
        audit(id, session(request), "ifc.preview", file.getOriginalFilename() + ": " + counts);
        return Map.of("schema", "IFC4", "counts", counts, "elements", elements, "fileId", modelId.toString(), "truncated", counts.values().stream().mapToInt(Integer::intValue).sum() > elements.size());
    }

    @GetMapping("/projects/{id}/ifc/{fileId}/elements")
    public Map<String, Object> ifcElements(@PathVariable String id, @PathVariable UUID fileId, HttpServletRequest request) throws Exception {
        row(id, session(request));
        List<byte[]> bodies = jdbc.query("SELECT body FROM passport_ifc_versions WHERE id=? AND project_id=?",
            (rs, rowNum) -> rs.getBytes(1), fileId, id);
        if (bodies.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return parseIfc(new java.io.ByteArrayInputStream(bodies.get(0)), true);
    }

    private Map<String, Object> parseIfc(java.io.InputStream input, boolean fullModel) throws Exception {
        List<Map<String, String>> elements = new ArrayList<>();
        Map<String, String> storeys = new HashMap<>();
        Map<String, String> elementRefs = new HashMap<>();
        Map<String, String> floorRefs = new HashMap<>();
        Map<String, Integer> counts = new LinkedHashMap<>();
        boolean ifc4 = false;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8), 65536)) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.contains("FILE_SCHEMA(('IFC4'))")) ifc4 = true;
                Matcher storey = STOREY.matcher(line);
                if (storey.find()) storeys.put(storey.group(1), decodeIfc(storey.group(2)));
                if (line.contains("IFCRELCONTAINEDINSPATIALSTRUCTURE")) {
                    int listStart = line.indexOf(",(#");
                    int listEnd = line.lastIndexOf("),#");
                    if (listStart >= 0 && listEnd > listStart) {
                        int floorEnd = line.indexOf(')', listEnd + 3);
                        if (floorEnd > listEnd) {
                            String floorRef = line.substring(listEnd + 3, floorEnd);
                            for (String ref : line.substring(listStart + 2, listEnd).split(","))
                                if (ref.startsWith("#")) floorRefs.put(ref.substring(1), floorRef);
                        }
                    }
                }
                Matcher m = ELEMENT.matcher(line);
                if (!m.find()) continue;
                String type = m.group(2).toUpperCase(Locale.ROOT);
                if (!fullModel && !PASSPORT_TYPES.contains(type)) continue;
                counts.merge(type, 1, Integer::sum);
                String rawName = m.group(4);
                String name = "$".equals(rawName) ? "" : decodeIfc(rawName.substring(1, rawName.length()-1));
                elementRefs.put(m.group(3), m.group(1));
                elements.add(new HashMap<>(Map.of("globalId", m.group(3), "expressId", m.group(1), "type", type, "name", name)));
            }
        }
        for (Map<String, String> element : elements) {
            String storeyRef = floorRefs.get(elementRefs.get(element.get("globalId")));
            element.put("floor", storeys.getOrDefault(storeyRef, "Не указан"));
        }
        if (!ifc4) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ожидается IFC4");
        return Map.of("schema", "IFC4", "counts", counts, "elements", elements, "truncated", counts.values().stream().mapToInt(Integer::intValue).sum() > elements.size());
    }
    private static String decodeIfc(String name) {
        Matcher matcher = UNICODE.matcher(name);
        StringBuffer out = new StringBuffer();
        while (matcher.find()) {
            String hex = matcher.group(1); StringBuilder decoded = new StringBuilder();
            for (int i=0; i+3<hex.length(); i+=4) decoded.append((char)Integer.parseInt(hex.substring(i,i+4),16));
            matcher.appendReplacement(out, Matcher.quoteReplacement(decoded.toString()));
        }
        matcher.appendTail(out);
        return out.toString().replace("''", "'");
    }

    @PostMapping(value="/projects/{id}/files", consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, String> upload(@PathVariable String id, @RequestPart("file") MultipartFile file, HttpServletRequest request) throws Exception {
        Session session = session(request); row(id, session);
        String name = Objects.requireNonNullElse(file.getOriginalFilename(), "");
        String lower = name.toLowerCase(Locale.ROOT);
        if (file.isEmpty() || file.getSize() > 10L * 1024 * 1024 || !(lower.endsWith(".pdf") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png")))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Нужен PDF, JPG или PNG до 10 МБ");
        byte[] bytes = file.getBytes();
        String type;
        if (bytes.length >= 4 && bytes[0]=='%' && bytes[1]=='P' && bytes[2]=='D' && bytes[3]=='F' && lower.endsWith(".pdf")) type="application/pdf";
        else if (bytes.length >= 3 && (bytes[0]&255)==255 && (bytes[1]&255)==216 && (bytes[2]&255)==255 && (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))) type="image/jpeg";
        else if (bytes.length >= 8 && (bytes[0]&255)==137 && bytes[1]==80 && bytes[2]==78 && bytes[3]==71 && lower.endsWith(".png")) type="image/png";
        else throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Содержимое файла не соответствует расширению");
        UUID fileId = UUID.randomUUID();
        jdbc.update("INSERT INTO passport_files(id,project_id,file_name,media_type,body,actor,organization) VALUES (?,?,?,?,?,?,?)",
            fileId, id, name, type, bytes, session.actor(), session.org());
        audit(id, session, "file.upload", name);
        return Map.of("id", fileId.toString(), "name", name, "type", type);
    }

    @GetMapping("/projects/{id}/files/{fileId}")
    public ResponseEntity<byte[]> file(@PathVariable String id, @PathVariable UUID fileId, HttpServletRequest request) {
        row(id, session(request));
        List<Map<String, Object>> files = jdbc.queryForList("SELECT file_name,media_type,body FROM passport_files WHERE id=? AND project_id=?", fileId, id);
        if (files.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        Map<String, Object> file = files.get(0);
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename*=UTF-8''" + java.net.URLEncoder.encode((String)file.get("file_name"), StandardCharsets.UTF_8))
            .contentType(MediaType.parseMediaType((String)file.get("media_type")))
            .body((byte[])file.get("body"));
    }

    @GetMapping("/projects/{id}/ifc/{fileId}")
    public ResponseEntity<byte[]> ifcFile(@PathVariable String id, @PathVariable UUID fileId, HttpServletRequest request) {
        row(id, session(request));
        List<Map<String, Object>> files = jdbc.queryForList("SELECT file_name,body FROM passport_ifc_versions WHERE id=? AND project_id=?", fileId, id);
        if (files.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        Map<String, Object> file = files.get(0);
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + java.net.URLEncoder.encode((String)file.get("file_name"), StandardCharsets.UTF_8))
            .contentType(MediaType.parseMediaType("application/x-step"))
            .body((byte[])file.get("body"));
    }
}
