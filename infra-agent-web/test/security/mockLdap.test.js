const assert = require("assert");
const jiti = require("jiti")(__filename);

const { __test__ldapEscape } = jiti("../../lib/security/adLdapClient.js");

assert.strictEqual(__test__ldapEscape("normal"), "normal");
assert.strictEqual(__test__ldapEscape("a*b"), "a\\2ab");
assert.strictEqual(__test__ldapEscape("(admin)"), "\\28admin\\29");
assert.strictEqual(__test__ldapEscape("domain\\user"), "domain\\5cuser");

const unsafeUsername = "*) (|(memberOf=*))";
const escaped = __test__ldapEscape(unsafeUsername);
assert(!escaped.includes("*"), "debe escapar comodines LDAP");
assert(!escaped.includes("("), "debe escapar parentesis abiertos LDAP");
assert(!escaped.includes(")"), "debe escapar parentesis cerrados LDAP");

console.log("mockLdap.test.js OK");
