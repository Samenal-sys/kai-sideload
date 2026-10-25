/**
 * Makes it so the left and right arrows change focus, ala Tab/Shift+Tab. This is mostly designed
 * for KaiOS devices.
 */
/* global document, addEventListener, removeEventListener, getSelection */
// TODO: email/number types are a special type, in that they return selectionStart/selectionEnd as null
// As far as I can tell, there is no way to actually get the caret position from these inputs. So we
// don't do the proper caret handling for those inputs, unfortunately.
// https://html.spec.whatwg.org/multipage/input.html#do-not-apply
var textInputTypes = ['text', 'search', 'url', 'password', 'tel'];
var checkboxRadioInputTypes = ['checkbox', 'radio'];
var focusTrapTest = undefined;
// This query is adapted from a11y-dialog
// https://github.com/edenspiekermann/a11y-dialog/blob/cf4ed81/a11y-dialog.js#L6-L18
var focusablesQuery = 'a[href], area[href], input, select, textarea, ' +
'button, iframe, object, embed, [contenteditable], [tabindex], ' +
'video[controls], audio[controls], summary';
function getActiveElement() {
    var activeElement = document.activeElement;
    while (activeElement.shadowRoot) {
        activeElement = activeElement.shadowRoot.activeElement;
    }
    return activeElement;
}
function isFocusable(element) {
    return element.matches(focusablesQuery) &&
    !element.disabled &&
    !/^-/.test(element.getAttribute('tabindex') || '') &&
    !element.hasAttribute('inert') && // see https://github.com/GoogleChrome/inert-polyfill
    (element.offsetWidth > 0 || element.offsetHeight > 0);
}
function getFocusTrapParent(element) {
    if (!focusTrapTest) {
        return;
    }
    var parent = element.parentElement;
    while (parent) {
        if (focusTrapTest(parent)) {
            return parent;
        }
        parent = parent.parentElement;
    }
}
function shouldIgnoreEvent(activeElement, forwardDirection) {
    var tagName = activeElement.tagName;
    var lockFocus = activeElement.getAttribute("focuslock")
    if (lockFocus) {
        return true
    }
    var isTextarea = tagName === 'TEXTAREA';
    var isTextInput = tagName === 'INPUT' &&
    textInputTypes.indexOf(activeElement.getAttribute('type').toLowerCase()) !== -1;
    var isContentEditable = activeElement.hasAttribute('contenteditable');
    if (!isTextarea && !isTextInput && !isContentEditable) {
        return false;
    }
    var selectionStart;
    var selectionEnd;
    var len;
    if (isContentEditable) {
        var selection = getSelection();
        selectionStart = selection.anchorOffset;
        selectionEnd = selection.focusOffset;
        len = activeElement.textContent.length;
    }
    else {
        selectionStart = activeElement.selectionStart;
        selectionEnd = activeElement.selectionEnd;
        len = activeElement.value.length;
    }
    // if the cursor is inside of a textarea/input, then don't focus to the next/previous element
    // unless the cursor is at the beginning or the end
    if (!forwardDirection && selectionStart === selectionEnd && selectionStart === 0) {
        return false;
    }
    else if (forwardDirection && selectionStart === selectionEnd && selectionStart === len) {
        return false;
    }
    return true;
}
function getNextCandidateNodeForShadowDomPolyfill(root, targetElement, forwardDirection, filter) {
    // When the shadydom polyfill is running, we can't use TreeWalker on ShadowRoots because
    // they aren't real Nodes. So we do this workaround where we run TreeWalker on the
    // children instead.
    var nodes = Array.prototype.slice.call(root.querySelectorAll('*'));
    var idx = nodes.indexOf(targetElement);
    if (forwardDirection) {
        nodes = nodes.slice(idx + 1);
    }
    else {
        if (idx === -1) {
            idx = nodes.length;
        }
        nodes = nodes.slice(0, idx);
        nodes.reverse();
    }
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node instanceof HTMLElement && filter.acceptNode(node) === NodeFilter.FILTER_ACCEPT) {
            return node;
        }
    }
    return undefined;
}
function getNextCandidateNode(root, targetElement, forwardDirection, filter) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, filter);
    if (targetElement) {
        walker.currentNode = targetElement;
    }
    if (forwardDirection) {
        return walker.nextNode();
    }
    else if (targetElement) {
        return walker.previousNode();
    }
    // iterating backwards through shadow root, use last child
    return walker.lastChild();
}
function isShadowDomPolyfill() {
    return typeof ShadowRoot !== 'undefined' &&
    // ShadowRoot.polyfill is just a hack for our unit tests
    ('polyfill' in ShadowRoot || !ShadowRoot.toString().includes('[native code]'));
}
function getNextNode(root, targetElement, forwardDirection) {
    var filter = {
        acceptNode: function (node) {
            return (node === targetElement || node.shadowRoot || isFocusable(node))
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
    };
    // TODO: remove this when we don't need to support the Shadow DOM polyfill
    var nextNode = isShadowDomPolyfill() && root instanceof ShadowRoot
    ? getNextCandidateNodeForShadowDomPolyfill(root, targetElement, forwardDirection, filter)
    : getNextCandidateNode(root, targetElement, forwardDirection, filter);
    if (nextNode && nextNode.shadowRoot) { // push into the shadow DOM
        return getNextNode(nextNode.shadowRoot, null, forwardDirection);
    }
    if (!nextNode && root.host) { // pop out of the shadow DOM
        return getNextNode(root.host.getRootNode(), root.host, forwardDirection);
    }
    return nextNode;
}
function focusNextOrPrevious(event, key) {
    var activeElement = getActiveElement();
    var forwardDirection = key === 'ArrowDown';
    if (shouldIgnoreEvent(activeElement, forwardDirection)) {
        return;
    }
    var root = getFocusTrapParent(activeElement) || activeElement.getRootNode();
    var nextNode = getNextNode(root, activeElement, forwardDirection);
    if (nextNode && nextNode !== activeElement) {
        nextNode.focus();
        event.preventDefault();
    }
}
function handleEnter(event) {
    var activeElement = getActiveElement();
    if (activeElement.tagName === 'INPUT' &&
        checkboxRadioInputTypes.indexOf(activeElement.getAttribute('type').toLowerCase()) !== -1) {
        // Explicitly override "enter" on an input and make it fire the checkbox/radio
        activeElement.click();
    event.preventDefault();
        }
}
function keyListener(event) {
    if (event.altKey || event.metaKey || event.ctrlKey) {
        return; // ignore e.g. Alt-Left and Ctrl-Right, which are used to switch browser tabs or navigate back/forward
    }
    var key = event.key;
    switch (key) {
        case 'ArrowUp':
        case 'ArrowDown': {
            focusNextOrPrevious(event, key);
            break;
        }
        case 'Enter': {
            handleEnter(event);
            break;
        }
    }
}
/**
 * Start listening for keyboard events. Attaches a listener to the window.
 */
function register() {
    addEventListener('keydown', keyListener);
}
/**
 * Stop listening for keyboard events. Unattaches a listener to the window.
 */
function unregister() {
    removeEventListener('keydown', keyListener);
}
/**
 * Set a focus trap test to identify any focus traps in the DOM, i.e. a top-level DOM node that indicates the root
 * of a focus trap. Once this is set, if focus changes within the focus trap, then will not leave the focus trap.
 * @param test: the test function
 * @see https://w3c.github.io/aria-practices/examples/dialog-modal/dialog.html
 */
function setFocusTrapTest(test) {
    focusTrapTest = test;
}

// export { register, setFocusTrapTest, unregister };
window.AKN = { register, setFocusTrapTest, unregister };

// This file is originally from https://github.com/nolanlawson/arrow-key-navigation, and is licensed under the following terms
/* -- MODIFICATIONS --
 * changed `export` to `window.AKN =` cause i didnt understand how to use it
 * changed left/right to up/down so it works better for my usage
 */


/*
 * Apache License
 * Version 2.0, January 2004
 * http://www.apache.org/licenses/
 *
 * TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
 *
 * 1. Definitions.
 *
 *    "License" shall mean the terms and conditions for use, reproduction, and
 *    distribution as defined by Sections 1 through 9 of this document.
 *
 *    "Licensor" shall mean the copyright owner or entity authorized by the
 *    copyright owner that is granting the License.
 *
 *    "Legal Entity" shall mean the union of the acting entity and all other
 *    entities that control, are controlled by, or are under common control with
 *    that entity. For the purposes of this definition, "control" means (i) the
 *    power, direct or indirect, to cause the direction or management of such
 *    entity, whether by contract or otherwise, or (ii) ownership of
 *    fifty percent (50%) or more of the outstanding shares, or (iii) beneficial
 *    ownership of such entity.
 *
 *    "You" (or "Your") shall mean an individual or Legal Entity exercising
 *    permissions granted by this License.
 *
 *    "Source" form shall mean the preferred form for making modifications,
 *    including but not limited to software source code, documentation source,
 *    and configuration files.
 *
 *    "Object" form shall mean any form resulting from mechanical transformation
 *    or translation of a Source form, including but not limited to compiled
 *    object code, generated documentation, and conversions to
 *    other media types.
 *
 *    "Work" shall mean the work of authorship, whether in Source or Object
 *    form, made available under the License, as indicated by a copyright notice
 *    that is included in or attached to the work (an example is provided in the
 *    Appendix below).
 *
 *    "Derivative Works" shall mean any work, whether in Source or Object form,
 *    that is based on (or derived from) the Work and for which the editorial
 *    revisions, annotations, elaborations, or other modifications represent,
 *    as a whole, an original work of authorship. For the purposes of this
 *    License, Derivative Works shall not include works that remain separable
 *    from, or merely link (or bind by name) to the interfaces of, the Work and
 *    Derivative Works thereof.
 *
 *    "Contribution" shall mean any work of authorship, including the original
 *    version of the Work and any modifications or additions to that Work or
 *    Derivative Works thereof, that is intentionally submitted to Licensor for
 *    inclusion in the Work by the copyright owner or by an individual or
 *    Legal Entity authorized to submit on behalf of the copyright owner.
 *    For the purposes of this definition, "submitted" means any form of
 *    electronic, verbal, or written communication sent to the Licensor or its
 *    representatives, including but not limited to communication on electronic
 *    mailing lists, source code control systems, and issue tracking systems
 *    that are managed by, or on behalf of, the Licensor for the purpose of
 *    discussing and improving the Work, but excluding communication that is
 *    conspicuously marked or otherwise designated in writing by the copyright
 *    owner as "Not a Contribution."
 *
 *    "Contributor" shall mean Licensor and any individual or Legal Entity on
 *    behalf of whom a Contribution has been received by Licensor and
 *    subsequently incorporated within the Work.
 *
 * 2. Grant of Copyright License.
 *
 *    Subject to the terms and conditions of this License, each Contributor
 *    hereby grants to You a perpetual, worldwide, non-exclusive, no-charge,
 *    royalty-free, irrevocable copyright license to reproduce, prepare
 *    Derivative Works of, publicly display, publicly perform, sublicense,
 *    and distribute the Work and such Derivative Works in
 *    Source or Object form.
 *
 * 3. Grant of Patent License.
 *
 *    Subject to the terms and conditions of this License, each Contributor
 *    hereby grants to You a perpetual, worldwide, non-exclusive, no-charge,
 *    royalty-free, irrevocable (except as stated in this section) patent
 *    license to make, have made, use, offer to sell, sell, import, and
 *    otherwise transfer the Work, where such license applies only to those
 *    patent claims licensable by such Contributor that are necessarily
 *    infringed by their Contribution(s) alone or by combination of their
 *    Contribution(s) with the Work to which such Contribution(s) was submitted.
 *    If You institute patent litigation against any entity (including a
 *    cross-claim or counterclaim in a lawsuit) alleging that the Work or a
 *    Contribution incorporated within the Work constitutes direct or
 *    contributory patent infringement, then any patent licenses granted to
 *    You under this License for that Work shall terminate as of the date such
 *    litigation is filed.
 *
 * 4. Redistribution.
 *
 *    You may reproduce and distribute copies of the Work or Derivative Works
 *    thereof in any medium, with or without modifications, and in Source or
 *    Object form, provided that You meet the following conditions:
 *
 *    1. You must give any other recipients of the Work or Derivative Works a
 *    copy of this License; and
 *
 *    2. You must cause any modified files to carry prominent notices stating
 *    that You changed the files; and
 *
 *    3. You must retain, in the Source form of any Derivative Works that You
 *    distribute, all copyright, patent, trademark, and attribution notices from
 *    the Source form of the Work, excluding those notices that do not pertain
 *    to any part of the Derivative Works; and
 *
 *    4. If the Work includes a "NOTICE" text file as part of its distribution,
 *    then any Derivative Works that You distribute must include a readable copy
 *    of the attribution notices contained within such NOTICE file, excluding
 *    those notices that do not pertain to any part of the Derivative Works,
 *    in at least one of the following places: within a NOTICE text file
 *    distributed as part of the Derivative Works; within the Source form or
 *    documentation, if provided along with the Derivative Works; or, within a
 *    display generated by the Derivative Works, if and wherever such
 *    third-party notices normally appear. The contents of the NOTICE file are
 *    for informational purposes only and do not modify the License.
 *    You may add Your own attribution notices within Derivative Works that You
 *    distribute, alongside or as an addendum to the NOTICE text from the Work,
 *    provided that such additional attribution notices cannot be construed
 *    as modifying the License.
 *
 *    You may add Your own copyright statement to Your modifications and may
 *    provide additional or different license terms and conditions for use,
 *    reproduction, or distribution of Your modifications, or for any such
 *    Derivative Works as a whole, provided Your use, reproduction, and
 *    distribution of the Work otherwise complies with the conditions
 *    stated in this License.
 *
 * 5. Submission of Contributions.
 *
 *    Unless You explicitly state otherwise, any Contribution intentionally
 *    submitted for inclusion in the Work by You to the Licensor shall be under
 *    the terms and conditions of this License, without any additional
 *    terms or conditions. Notwithstanding the above, nothing herein shall
 *    supersede or modify the terms of any separate license agreement you may
 *    have executed with Licensor regarding such Contributions.
 *
 * 6. Trademarks.
 *
 *    This License does not grant permission to use the trade names, trademarks,
 *    service marks, or product names of the Licensor, except as required for
 *    reasonable and customary use in describing the origin of the Work and
 *    reproducing the content of the NOTICE file.
 *
 * 7. Disclaimer of Warranty.
 *
 *    Unless required by applicable law or agreed to in writing, Licensor
 *    provides the Work (and each Contributor provides its Contributions)
 *    on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
 *    either express or implied, including, without limitation, any warranties
 *    or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS
 *    FOR A PARTICULAR PURPOSE. You are solely responsible for determining the
 *    appropriateness of using or redistributing the Work and assume any risks
 *    associated with Your exercise of permissions under this License.
 *
 * 8. Limitation of Liability.
 *
 *    In no event and under no legal theory, whether in tort
 *    (including negligence), contract, or otherwise, unless required by
 *    applicable law (such as deliberate and grossly negligent acts) or agreed
 *    to in writing, shall any Contributor be liable to You for damages,
 *    including any direct, indirect, special, incidental, or consequential
 *    damages of any character arising as a result of this License or out of
 *    the use or inability to use the Work (including but not limited to damages
 *    for loss of goodwill, work stoppage, computer failure or malfunction,
 *    or any and all other commercial damages or losses), even if such
 *    Contributor has been advised of the possibility of such damages.
 *
 * 9. Accepting Warranty or Additional Liability.
 *
 *    While redistributing the Work or Derivative Works thereof, You may choose
 *    to offer, and charge a fee for, acceptance of support, warranty,
 *    indemnity, or other liability obligations and/or rights consistent with
 *    this License. However, in accepting such obligations, You may act only
 *    on Your own behalf and on Your sole responsibility, not on behalf of any
 *    other Contributor, and only if You agree to indemnify, defend, and hold
 *    each Contributor harmless for any liability incurred by, or claims
 *    asserted against, such Contributor by reason of your accepting any such
 *    warranty or additional liability.
 *
 * END OF TERMS AND CONDITIONS
 *
 * APPENDIX: How to apply the Apache License to your work
 *
 *    To apply the Apache License to your work, attach the following boilerplate
 *    notice, with the fields enclosed by brackets "[]" replaced with your own
 *    identifying information. (Don't include the brackets!) The text should be
 *    enclosed in the appropriate comment syntax for the file format. We also
 *    recommend that a file or class name and description of purpose be included
 *    on the same "printed page" as the copyright notice for easier
 *    identification within third-party archives.
 *
 *        Copyright 2019 Nolan Lawson
 *
 *
 *        Licensed under the Apache License, Version 2.0 (the "License");
 *        you may not use this file except in compliance with the License.
 *        You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *        Unless required by applicable law or agreed to in writing, software
 *        distributed under the License is distributed on an "AS IS" BASIS,
 *        WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 *        or implied. See the License for the specific language governing
 *        permissions and limitations under the License.
 *
*/
